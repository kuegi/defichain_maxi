import {
  LoanVaultActive,
  LoanVaultLiquidated,
  LoanVaultState,
  LoanVaultTokenAmount,
} from '@defichain/whale-api-client/dist/api/loan'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { Telegram } from '../utils/telegram'
import { CommonProgram, ProgramState } from './common-program'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { WalletSetup } from '../utils/wallet-setup'
import { AddressToken } from '@defichain/whale-api-client/dist/api/address'
import { fromAddress } from '@defichain/jellyfish-address'
import { CTransaction, PoolId, Script, TokenBalanceUInt32 } from '@defichain/jellyfish-transaction'
import { isNullOrEmpty } from '../utils/helpers'
import { Prevout } from '@defichain/jellyfish-transaction-builder'

import { DONATION_ADDRESS, DONATION_ADDRESS_TESTNET, DONATION_MAX_PERCENTAGE } from '../vault-maxi'
import { VERSION } from '../vault-maxi'
import { IStore } from '../utils/store'
import { Token } from 'aws-sdk/clients/cloudwatchlogs'
import { TokenData } from '@defichain/whale-api-client/dist/api/tokens'

export enum VaultMaxiProgramTransaction {
  None = 'none',
  RemoveLiquidity = 'removeliquidity',
  PaybackLoan = 'paybackloan',
  TakeLoan = 'takeloan',
  AddLiquidity = 'addliquidity',
  Reinvest = 'reinvest',
  StableArbitrage = 'stablearbitrage',
}

export class CheckedValues {
  //used addres. only set if wallet initialized and address found
  address: string | undefined
  // monitored vault. only set if vault found
  vault: string | undefined

  minCollateralRatio: number = 0
  maxCollateralRatio: number = -1
  assetA: string | undefined
  assetB: string | undefined
  reinvest: number | undefined

  constructMessage(): string {
    return (
      '' +
      'Setup-Check result\n' +
      (this.vault ? 'monitoring vault ' + this.vault : 'no vault found') +
      '\n' +
      (this.address ? 'from address ' + this.address : 'no valid address') +
      '\n' +
      'Set collateral ratio range ' +
      this.minCollateralRatio +
      '-' +
      this.maxCollateralRatio +
      '\n' +
      (this.assetA ? 'using pool ' + this.assetA + '-' + this.assetB : 'no pool found for token ') +
      '\n' +
      (this.reinvest && this.reinvest > 0 ? 'Will reinvest above ' + this.reinvest + ' DFI' : 'Will not reinvest')
    )
  }
}

class ReinvestTarget {
  tokenName: string
  percent: number | undefined
  targetAddress: string | undefined
  targetScript: Script | undefined
  isCollateral: boolean

  constructor(
    tokenName: string,
    percent: number | undefined,
    isCollateral: boolean,
    targetAddress: string | undefined = undefined,
    targetScript: Script | undefined = undefined,
  ) {
    this.tokenName = tokenName
    this.percent = percent
    this.isCollateral = isCollateral
    this.targetAddress = targetAddress
    this.targetScript = targetScript
  }
}

export class VaultMaxiProgram extends CommonProgram {
  private targetCollateral: number
  readonly lmPair: string
  readonly assetA: string
  readonly assetB: string
  private mainCollateralAsset: string
  private isSingleMint: boolean
  private readonly keepWalletClean: boolean
  private readonly swapRewardsToMainColl: boolean
  private readonly minValueForCleanup: number = 0.1
  private readonly maxPercentDiffInConsistencyChecks: number = 1

  private negInterestWorkaround: boolean = false
  public readonly dusdTokenId: number

  private reinvestTargets: ReinvestTarget[] = []

  constructor(store: IStore, walletSetup: WalletSetup) {
    super(store, walletSetup)
    this.dusdTokenId = walletSetup.isTestnet() ? 11 : 15
    this.lmPair = this.settings.LMPair
    ;[this.assetA, this.assetB] = this.lmPair.split('-')
    this.mainCollateralAsset = this.settings.mainCollateralAsset
    this.isSingleMint = this.mainCollateralAsset == 'DUSD' || this.lmPair == 'DUSD-DFI'

    this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200
    this.keepWalletClean = process.env.VAULTMAXI_KEEP_CLEAN !== 'false' ?? true
    this.swapRewardsToMainColl = process.env.VAULTMAXI_SWAP_REWARDS_TO_MAIN !== 'false' ?? true
  }

  async initReinvestTargets() {
    let pattern = this.settings.reinvestPattern
    if (pattern === undefined || pattern === '') {
      //no pattern provided? pattern = "<mainCollateralAsset>" if should swap, else "DFI"
      pattern = process.env.VAULTMAXI_SWAP_REWARDS_TO_MAIN !== 'false' ?? true ? this.mainCollateralAsset : 'DFI'
    }
    console.log('init reinvest targets from ' + pattern + ' split: ' + JSON.stringify(pattern?.split(' ')))
    // sample reinvest:
    // DFI:10:df1cashOutAddress DFI BTC:10 SPY:20 GLD:20
    // -> send 10% of DFI to address
    // swap 10% to BTC (will be added to vault cause its collateral)
    // swap 20% to SPY
    // swap 20% to GLD
    // rest (40%) as DFI into vault

    // DFI:50 DFI::df1cashoutAddress BTC:20:df1otherAddress DUSD
    // 50% in DFI in vault
    // 20% swapped to BTC and send to otherAddress
    // rest (30%) is split to
    //  15% send to cashout as DFI
    //  15% swapped to DUSD and reinvested

    let totalPercent = 0
    let targetsWithNoPercent = 0
    pattern!.split(' ').forEach((target) => {
      const parts = target.split(':')
      const tokenName = parts[0]
      const percent = parts.length > 1 ? parts[1] : ''
      const address = parts.length > 2 ? parts[2] : ''
      const token = this.getCollateralTokenByKey(tokenName)
      const isCollateral = token !== undefined
      let percentValue = undefined
      if (percent === '') {
        targetsWithNoPercent++
      } else {
        percentValue = +percent
        totalPercent += percentValue
      }
      let script = undefined
      if (address !== '') {
        script = fromAddress(address, this.walletSetup.network.name)?.script
      }
      this.reinvestTargets.push(
        new ReinvestTarget(tokenName, percentValue, isCollateral, address === '' ? undefined : address, script),
      )
    })

    const remainingPercent = totalPercent < 100 ? (100 - totalPercent) / targetsWithNoPercent : 0
    for (const target of this.reinvestTargets) {
      if (target.percent === undefined) {
        target.percent = remainingPercent
      }
    }
    console.log('got ' + this.reinvestTargets.length + ' targets with ' + totalPercent + ' defined percent.')
  }

  async init(): Promise<boolean> {
    let result = await super.init()
    const blockheight = await this.getBlockHeight()
    //workaround before FCE height
    this.negInterestWorkaround = this.walletSetup.isTestnet() ? blockheight < 1244000 : blockheight < 2257500
    console.log(
      'initialized at block ' +
        blockheight +
        ' ' +
        (this.negInterestWorkaround ? 'using negative interest workaround' : '') +
        ' dusd CollValue is ' +
        this.getCollateralFactor('' + this.dusdTokenId).toFixed(3),
    )
    await this.initReinvestTargets()

    return result
  }

  static shouldCleanUpBasedOn(transaction: VaultMaxiProgramTransaction): boolean {
    return (
      transaction == VaultMaxiProgramTransaction.RemoveLiquidity || transaction == VaultMaxiProgramTransaction.TakeLoan
    )
  }

  targetRatio(): number {
    return this.targetCollateral
  }

  isSingle(): boolean {
    return this.isSingleMint
  }

  logVaultData(vault: LoanVaultActive): void {
    console.log(
      'working with vault ' +
        vault.vaultId +
        ' state: ' +
        vault.state +
        ' current Ratio ' +
        vault.collateralRatio +
        '(' +
        vault.informativeRatio +
        ') collValue: ' +
        vault.collateralValue +
        ' loanValue: ' +
        vault.loanValue,
    )
    const collMsg = vault.collateralAmounts
      .map(
        (coll) =>
          coll.symbol +
          ': ' +
          coll.amount +
          '@' +
          (coll.activePrice?.active?.amount ?? 1) +
          '->' +
          (coll.activePrice?.next?.amount ?? 1) +
          ' x ' +
          this.getCollateralFactor(coll.id),
      )
      .reduce((prev, cur) => prev + ' | ' + cur, '')
    console.log('collaterals: ' + collMsg)
    const loanMsg = vault.loanAmounts
      .map(
        (coll) =>
          coll.symbol +
          ': ' +
          coll.amount +
          '@' +
          (coll.activePrice?.active?.amount ?? 1) +
          '->' +
          (coll.activePrice?.next?.amount ?? 1),
      )
      .reduce((prev, cur) => prev + ' | ' + cur, '')
    console.log('loans: ' + loanMsg)
  }

  consistencyChecks(vault: LoanVaultActive): boolean {
    console.log('doing consistency checks')
    //check calculated active collateral ratio vs. ratio from ocean (to make sure oracle prices match)
    const collValue = vault.collateralAmounts
      .map((coll) =>
        this.getCollateralFactor(coll.id)
          .times(coll.amount)
          .times(coll.activePrice?.active?.amount ?? 1),
      )
      .reduce((prev, cur) => prev.plus(cur), new BigNumber(0))
    const loanValue = vault.loanAmounts
      .map((coll) => new BigNumber(coll.amount).times(coll.activePrice?.active?.amount ?? 1))
      .reduce((prev, cur) => prev.plus(cur), new BigNumber(0))
    const ratio = loanValue.gt(0) ? collValue.div(loanValue).times(100) : new BigNumber(-1)
    console.log(
      'calculated values: collValue: ' +
        collValue.toFixed(8) +
        ' loanValue: ' +
        loanValue.toFixed(8) +
        ' ratio: ' +
        ratio.toFixed(8),
    )
    const percThreshold = this.maxPercentDiffInConsistencyChecks / 100
    if (loanValue.minus(vault.loanValue).absoluteValue().div(loanValue).gt(percThreshold)) {
      // more than 1% difference -> problem
      console.warn('inconsistency in loanValue: ' + loanValue.toFixed(8) + ' vs ' + vault.loanValue)
      return false
    }
    if (collValue.minus(vault.collateralValue).absoluteValue().div(collValue).gt(percThreshold)) {
      // more than 1% difference -> problem
      console.warn('inconsistency in collateralValue: ' + collValue.toFixed(8) + ' vs ' + vault.collateralValue)
      return false
    }
    if (
      loanValue.gt(collValue.div(100)) && //super low loan (empty or ratio > 10000%) could lead to floating point errors or div by zero -> no need to check consistency anyway
      ratio.minus(vault.informativeRatio).absoluteValue().gt(this.maxPercentDiffInConsistencyChecks)
    ) {
      console.warn('inconsistency in collRatio: ' + ratio.toFixed(8) + ' vs ' + vault.informativeRatio)
      return false
    }
    return true
  }

  getUsedOraclePrice(token: LoanVaultTokenAmount | undefined, isCollateral: boolean): BigNumber {
    if (token === undefined) {
      return new BigNumber(0)
    }
    if (token.symbol === 'DUSD') {
      let result = new BigNumber(1)
      if (isCollateral) {
        result = result.times(this.getCollateralFactor(token.id))
      }
      return result
    }
    if (isCollateral) {
      return BigNumber.min(token.activePrice?.active?.amount ?? 0, token.activePrice?.next?.amount ?? 0).times(
        this.getCollateralFactor(token.id),
      )
    } else {
      return BigNumber.max(token.activePrice?.active?.amount ?? 1, token.activePrice?.next?.amount ?? 1)
    }
  }

  nextCollateralValue(vault: LoanVaultActive): BigNumber {
    let nextCollateral = new BigNumber(0)
    vault.collateralAmounts.forEach((collateral) => {
      const collValue = this.getCollateralFactor(collateral.id)
        .multipliedBy(collateral.activePrice?.next?.amount ?? 1) //DUSD oracle = 1
        .multipliedBy(collateral.amount)
      nextCollateral = nextCollateral.plus(collValue)
    })
    return nextCollateral
  }

  nextLoanValue(vault: LoanVaultActive): BigNumber {
    let nextLoan = new BigNumber(0)
    vault.loanAmounts.forEach((loan) => {
      if (loan.symbol == 'DUSD') {
        nextLoan = nextLoan.plus(loan.amount) // no oracle for DUSD
      } else {
        nextLoan = nextLoan.plus(new BigNumber(loan.amount).multipliedBy(loan.activePrice?.next?.amount ?? 1))
      }
    })
    return nextLoan
  }

  nextCollateralRatio(vault: LoanVaultActive): BigNumber {
    const nextLoan = this.nextLoanValue(vault)
    return nextLoan.lte(0)
      ? new BigNumber(-1)
      : this.nextCollateralValue(vault).dividedBy(nextLoan).multipliedBy(100).decimalPlaces(0, BigNumber.ROUND_FLOOR)
  }

  async doMaxiChecks(
    telegram: Telegram,
    vaultcheck: LoanVaultActive | LoanVaultLiquidated,
    pool: PoolPairData | undefined,
    balances: Map<string, AddressToken>,
  ): Promise<boolean> {
    if (!super.doValidationChecks(telegram, true)) {
      return false
    }
    if (!vaultcheck) {
      const message =
        'Could not find vault. ' + 'trying vault ' + this.settings.vault + ' in ' + this.settings.address + '. '
      await telegram.send(message)
      console.error(message)
      return false
    }
    if (vaultcheck.ownerAddress !== this.settings.address) {
      const message = 'Error: vault not owned by this address'
      await telegram.send(message)
      console.error(message)
      return false
    }
    if (vaultcheck.state === LoanVaultState.IN_LIQUIDATION) {
      const message = "Error: Can't maximize a vault in liquidation!"
      await telegram.send(message)
      console.error(message)
      return false
    }
    if (this.assetB != 'DUSD' && this.lmPair != 'DUSD-DFI') {
      const message = 'vaultMaxi only works on dStock-DUSD pools or DUSD-DFI not on ' + this.lmPair
      await telegram.send(message)
      console.error(message)
      return false
    }
    if (!pool) {
      const message = 'No pool found for this token. tried: ' + this.lmPair
      await telegram.send(message)
      console.error(message)
      return false
    }

    const utxoBalance = await this.getUTXOBalance()
    if (utxoBalance.lte(1e-4)) {
      //1 tx is roughly 2e-6 fee, one action mainly 3 tx -> 6e-6 fee. we want at least 10 actions safety -> below 1e-4 we warn
      if (utxoBalance.lte(0)) {
        //can't work with no UTXOs
        const message =
          'you have no UTXOs left in ' +
          this.settings.address +
          ". Please replenish otherwise you maxi can't protect your vault!"
        await telegram.send(message)
        await telegram.log(message)
        console.warn(message)
        return false
      }
      const message =
        'your UTXO balance is running low in ' +
        this.settings.address +
        ', only ' +
        utxoBalance.toFixed(5) +
        ' DFI left. Please replenish to prevent any errors'
      await telegram.send(message)
      console.warn(message)
    }
    // showstoppers checked, now check for warnings or automatic adaptions

    if (+vaultcheck.loanScheme.minColRatio >= this.settings.minCollateralRatio) {
      const message =
        'minCollateralRatio is too low. ' +
        'thresholds ' +
        this.settings.minCollateralRatio +
        ' - ' +
        this.settings.maxCollateralRatio +
        '. loanscheme minimum is ' +
        vaultcheck.loanScheme.minColRatio +
        ' will use ' +
        (+vaultcheck.loanScheme.minColRatio + 1) +
        ' as minimum'
      await telegram.send(message)
      console.warn(message)
      this.settings.minCollateralRatio = +vaultcheck.loanScheme.minColRatio + 1
    }

    const minRange = 2
    if (
      this.settings.maxCollateralRatio > 0 &&
      this.settings.minCollateralRatio > this.settings.maxCollateralRatio - minRange
    ) {
      const message =
        'Min collateral must be more than ' +
        minRange +
        ' below max collateral. Please change your settings. ' +
        'thresholds ' +
        this.settings.minCollateralRatio +
        ' - ' +
        this.settings.maxCollateralRatio +
        ' will use ' +
        this.settings.minCollateralRatio +
        ' - ' +
        (this.settings.minCollateralRatio + minRange)
      await telegram.send(message)
      console.warn(message)
      this.settings.maxCollateralRatio = this.settings.minCollateralRatio + minRange
    }
    this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200

    if (this.mainCollateralAsset != 'DUSD' && this.mainCollateralAsset != 'DFI') {
      const message = "can't use this main collateral: " + this.mainCollateralAsset + '. falling back to DFI'
      await telegram.send(message)
      console.warn(message)
      this.mainCollateralAsset = 'DFI'
    }
    if (this.mainCollateralAsset != 'DFI' && this.assetB != this.mainCollateralAsset) {
      const message =
        "can't work with this combination of mainCollateralAsset " +
        this.mainCollateralAsset +
        ' and lmPair ' +
        this.lmPair
      await telegram.send(message)
      console.warn(message)
      this.mainCollateralAsset = 'DFI'
    }

    this.isSingleMint = this.mainCollateralAsset == 'DUSD' || this.lmPair == 'DUSD-DFI'

    const vault = vaultcheck as LoanVaultActive
    if (vault.state != LoanVaultState.FROZEN) {
      //coll ratio checks only done if not frozen (otherwise the ratio might be off)
      //if frozen: its handled outside anyway

      const safetyOverride = process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE
        ? +process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE
        : undefined
      const safeCollRatio = safetyOverride ?? +vault.loanScheme.minColRatio * 2
      if (safetyOverride) {
        console.log('using override for vault safety level: ' + safetyOverride)
      }
      if (+vault.collateralRatio > 0 && +vault.collateralRatio < safeCollRatio) {
        //check if we could provide safety
        const lpTokens = balances.get(this.lmPair)
        const tokenLoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetA)
        const dusdLoan = vault.loanAmounts.find((loan) => loan.symbol == 'DUSD')
        if (!lpTokens || !tokenLoan || (!this.isSingleMint && !dusdLoan)) {
          const message =
            'vault ratio not safe but either no lpTokens or no loans in vault.\nDid you change the LMToken? Your vault is NOT safe! '
          await telegram.send(message)
          console.warn(message)
        } else {
          const safeRatio = safeCollRatio / 100
          const neededrepay = new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).div(safeRatio))
          if (!this.isSingleMint) {
            const neededStock = neededrepay.div(
              BigNumber.sum(this.getUsedOraclePrice(tokenLoan, false), pool!.priceRatio.ba),
            )
            const neededDusd = neededStock.multipliedBy(pool!.priceRatio.ba)
            const stock_per_token = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
            const neededLPtokens = neededStock.div(stock_per_token)
            if (
              neededLPtokens.gt(lpTokens.amount) ||
              neededDusd.gt(dusdLoan!.amount) ||
              neededStock.gt(tokenLoan.amount)
            ) {
              const message =
                'vault ratio not safe but not enough lptokens or loans to be able to guard it.\nDid you change the LMToken? Your vault is NOT safe!\n' +
                'wanted ' +
                neededLPtokens.toFixed(4) +
                ' but got ' +
                (+lpTokens.amount).toFixed(4) +
                ' ' +
                lpTokens.symbol +
                '\nwanted ' +
                neededDusd.toFixed(1) +
                ' but got ' +
                (+dusdLoan!.amount).toFixed(1) +
                ' ' +
                dusdLoan!.symbol +
                '\nwanted ' +
                neededStock.toFixed(4) +
                ' but got ' +
                (+tokenLoan.amount).toFixed(4) +
                ' ' +
                tokenLoan.symbol +
                '\n'
              await telegram.send(message)
              console.warn(message)
            }
          } else {
            let oracleA = this.getUsedOraclePrice(tokenLoan, false)
            let oracleB = this.getUsedOraclePrice(
              vault.collateralAmounts.find((coll) => coll.symbol === this.assetB),
              true,
            )

            const neededLPtokens = neededrepay
              .times(safeRatio)
              .times(pool.totalLiquidity.token)
              .div(
                BigNumber.sum(oracleA.times(pool.tokenA.reserve).times(safeRatio), oracleB.times(pool.tokenB.reserve)),
              )

            const neededAssetA = neededLPtokens.times(pool.tokenA.reserve).div(pool.totalLiquidity.token)
            if (neededLPtokens.gt(lpTokens.amount) || neededAssetA.gt(tokenLoan.amount)) {
              const message =
                'vault ratio not safe but not enough lptokens or loans to be able to guard it.\n' +
                'Did you change the LMToken? Your vault is NOT safe!\n' +
                'wanted ' +
                neededLPtokens.toFixed(4) +
                ' but got ' +
                (+lpTokens.amount).toFixed(4) +
                ' ' +
                lpTokens.symbol +
                '\nwanted ' +
                neededAssetA.toFixed(4) +
                ' but got ' +
                (+tokenLoan.amount).toFixed(4) +
                ' ' +
                tokenLoan.symbol +
                '\n'
              await telegram.send(message)
              console.warn(message)
            }
          }
        }
      }
    }

    // sanity check for auto-donate feature, do NOT allow auto-donate above our defined max percentage
    this.settings.autoDonationPercentOfReinvest = Math.min(
      this.settings.autoDonationPercentOfReinvest,
      DONATION_MAX_PERCENTAGE,
    )

    //check reinvest pattern
    let totalSum = 0
    for (const target of this.reinvestTargets) {
      if (target.targetAddress !== undefined && target.targetScript === undefined) {
        const message = 'reinvest target address ' + target.targetAddress + ' is not valid'
        await telegram.send(message)
        console.warn(message)
      }
      if (target.percent! < 0 || target.percent! > 100) {
        const message = 'invalid percent (' + target.percent + ') in reinvest target ' + target.tokenName
        await telegram.send(message)
        console.warn(message)
      }
      totalSum += target.percent!
    }
    totalSum = Math.round(totalSum)
    if (totalSum != 100) {
      const message = 'sum of reinvest targets is not 100%. Its ' + totalSum
      await telegram.send(message)
      console.warn(message)
    }

    return true
  }

  async calcSafetyLevel(
    vault: LoanVaultActive,
    pool: PoolPairData,
    balances: Map<string, AddressToken>,
  ): Promise<BigNumber> {
    const lpTokens = balances.get(this.lmPair)
    const assetALoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetA)
    const assetBLoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetB)
    if (!lpTokens || !assetALoan || (!this.isSingleMint && !assetBLoan)) {
      return new BigNumber(0)
    }
    const assetAPerToken = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
    let usedAssetA = assetAPerToken.multipliedBy(lpTokens.amount)
    let maxRatioNum: BigNumber
    let maxRatioDenom: BigNumber

    if (!this.isSingleMint) {
      const tokenOracle = this.getUsedOraclePrice(assetALoan, false)
      let usedAssetB = usedAssetA.multipliedBy(pool!.priceRatio.ba)
      if (usedAssetA.gt(assetALoan.amount)) {
        usedAssetA = new BigNumber(assetALoan.amount)
        usedAssetB = usedAssetA.multipliedBy(pool!.priceRatio.ba)
      }
      if (usedAssetB.gt(assetBLoan!.amount)) {
        usedAssetB = new BigNumber(assetBLoan!.amount)
        usedAssetA = usedAssetB.multipliedBy(pool!.priceRatio.ab)
      }
      console.log(
        'could pay back up to ' +
          usedAssetB.toFixed(4) +
          '@' +
          this.assetB +
          ' and ' +
          usedAssetA.toFixed(4) +
          '@' +
          this.assetA,
      )

      maxRatioNum = new BigNumber(vault.collateralValue)
      maxRatioDenom = new BigNumber(vault.loanValue).minus(usedAssetB).minus(usedAssetA.multipliedBy(tokenOracle))
    } else {
      const oracleA = this.getUsedOraclePrice(assetALoan, false)
      const oracleB = this.getUsedOraclePrice(
        vault.collateralAmounts.find((coll) => coll.symbol == this.assetB),
        true,
      )
      let usedLpTokens = new BigNumber(lpTokens.amount)
      if (usedAssetA.gt(assetALoan.amount)) {
        usedAssetA = new BigNumber(assetALoan.amount)
        usedLpTokens = usedAssetA.div(assetAPerToken)
      }
      console.log(
        'could use up to ' +
          usedLpTokens.toFixed(8) +
          ' LP Tokens leading to payback of ' +
          usedAssetA.toFixed(4) +
          '@' +
          this.assetA,
      )

      const lpPerTL = usedLpTokens.dividedBy(pool.totalLiquidity.token)
      maxRatioNum = BigNumber.sum(lpPerTL.times(pool.tokenB.reserve).times(oracleB), vault.collateralValue)
      maxRatioDenom = new BigNumber(vault.loanValue).minus(lpPerTL.times(pool.tokenA.reserve).times(oracleA))
    }
    if (maxRatioDenom.lt(1)) {
      return new BigNumber(99999)
    }
    return maxRatioNum.div(maxRatioDenom).multipliedBy(100)
  }

  async doAndReportCheck(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, true)) {
      return false //report already send inside
    }
    var values = new CheckedValues()

    let walletAddress = this.getAddress()
    let vault = await this.getVault()
    let pool = await this.getPool(this.lmPair)

    values.address = walletAddress === this.settings.address ? walletAddress : undefined
    values.vault =
      vault?.vaultId === this.settings.vault && vault.ownerAddress == walletAddress ? vault.vaultId : undefined
    values.minCollateralRatio = this.settings.minCollateralRatio
    values.maxCollateralRatio = this.settings.maxCollateralRatio

    values.assetA = pool && pool.symbol == this.lmPair ? this.assetA : undefined
    values.assetB = values.assetA ? this.assetB : undefined
    if (this.assetB != 'DUSD' && this.lmPair != 'DUSD-DFI') {
      values.assetA = values.assetB = undefined
    }
    values.reinvest = this.settings.reinvestThreshold
    const autoDonationMessage =
      this.settings.autoDonationPercentOfReinvest > DONATION_MAX_PERCENTAGE
        ? 'Thank you for donating ' +
          DONATION_MAX_PERCENTAGE +
          '% of your rewards. You set to donate ' +
          this.settings.autoDonationPercentOfReinvest +
          '% which is great but feels like an input error. Donation was reduced to ' +
          DONATION_MAX_PERCENTAGE +
          '% of your reinvest. Feel free to donate more manually'
        : 'Thank you for donating ' + this.settings.autoDonationPercentOfReinvest + '% of your rewards'

    const message =
      values.constructMessage() +
      '\n' +
      (this.keepWalletClean ? 'trying to keep the wallet clean' : 'ignoring dust and commissions') +
      '\n' +
      (this.isSingleMint ? 'minting only ' + this.assetA : 'minting both assets') +
      '\nmain collateral asset is ' +
      this.mainCollateralAsset +
      (this.settings.reinvestThreshold ?? -1 >= 0
        ? '\n' +
          (this.swapRewardsToMainColl && this.mainCollateralAsset != 'DFI'
            ? ' will swap rewards to ' + this.mainCollateralAsset + ' before reinvest'
            : 'will directly reinvest DFI')
        : '') +
      '\n' +
      (this.settings.autoDonationPercentOfReinvest > 0 ? autoDonationMessage : 'auto donation is turned off') +
      '\n' +
      (this.settings.stableCoinArbBatchSize > 0
        ? 'searching for arbitrage with batches of size ' + this.settings.stableCoinArbBatchSize
        : 'not searching for stablecoin arbitrage') +
      '\nusing ocean at: ' +
      this.walletSetup.url

    console.log(message)
    console.log('using telegram for log: ' + telegram.logToken + ' chatId: ' + telegram.logChatId)
    console.log('using telegram for notification: ' + telegram.token + ' chatId: ' + telegram.chatId)
    await telegram.send(message)
    await telegram.log('log channel active')

    return true
  }

  async decreaseExposure(vault: LoanVaultActive, pool: PoolPairData, telegram: Telegram): Promise<boolean> {
    const neededrepay = BigNumber.max(
      new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).dividedBy(this.targetCollateral)),
      this.nextLoanValue(vault).minus(this.nextCollateralValue(vault).div(this.targetCollateral)),
    )
    if (neededrepay.lte(0) || !pool) {
      console.error(
        'negative repay or no pool, whats happening? loans:' +
          vault.loanValue +
          '/' +
          this.nextLoanValue(vault) +
          ' cols:' +
          vault.collateralValue +
          '/' +
          this.nextCollateralValue(vault) +
          ' target:' +
          this.targetCollateral,
      )
      await telegram.send('ERROR: invalid reduce calculation. please check')
      return false
    }
    let tokens = await this.getTokenBalances()
    let assetBLoan: BigNumber = new BigNumber(0)
    let assetALoan: BigNumber = new BigNumber(0)
    let oracleA: BigNumber = new BigNumber(0)
    vault.loanAmounts.forEach((loanamount) => {
      if (loanamount.symbol == this.assetA) {
        assetALoan = new BigNumber(loanamount.amount)
        oracleA = this.getUsedOraclePrice(loanamount, false)
      }
      if (loanamount.symbol == this.assetB) {
        assetBLoan = new BigNumber(loanamount.amount)
      }
    })
    const lptokens: BigNumber = new BigNumber(tokens.get(this.lmPair)?.amount ?? '0')
    if (lptokens.lte(0) || assetALoan.lte(0) || (!this.isSingleMint && assetBLoan.lte(0))) {
      await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
      console.error("can't withdraw from pool, no tokens left or no loans left")
      return false
    }
    let wantedTokens: BigNumber
    if (!this.isSingleMint) {
      wantedTokens = neededrepay
        .times(pool!.totalLiquidity.token)
        .div(BigNumber.sum(oracleA.times(pool.tokenA.reserve), pool.tokenB.reserve)) //would be oracleB* pool!.tokenB.reserve but oracleB is always 1 for DUSD as loan, and we do not have other double mints
    } else {
      let oracleB = this.getUsedOraclePrice(
        vault.collateralAmounts.find((coll) => coll.symbol == this.assetB),
        true,
      )

      wantedTokens = neededrepay
        .times(this.targetCollateral)
        .times(pool.totalLiquidity.token)
        .div(
          BigNumber.sum(
            oracleA.times(pool.tokenA.reserve).times(this.targetCollateral), //additional "times" due to part collateral, part loan
            oracleB.times(pool.tokenB.reserve),
          ),
        )
    }

    const removeTokens = BigNumber.min(wantedTokens, lptokens)

    const expectedA = removeTokens.times(pool.tokenA.reserve).div(pool.totalLiquidity.token)
    const expectedB = removeTokens.times(pool.tokenB.reserve).div(pool.totalLiquidity.token)

    console.log(
      'reducing exposure by ' +
        neededrepay.toFixed(4) +
        ' USD: ' +
        expectedA.toFixed(4) +
        '@' +
        this.assetA +
        ' ' +
        expectedB.toFixed(4) +
        '@' +
        this.assetB +
        ' from ' +
        lptokens.toFixed(8) +
        ' existing LPTokens',
    )

    console.log(' would need ' + wantedTokens.toFixed(8) + ' doing ' + removeTokens.toFixed(8) + ' ')
    const removeTx = await this.removeLiquidity(+pool.id, removeTokens)

    await this.updateToState(
      ProgramState.WaitingForTransaction,
      VaultMaxiProgramTransaction.RemoveLiquidity,
      removeTx.txId,
    )

    if (!(await this.waitForTx(removeTx.txId))) {
      await telegram.send('ERROR: when removing liquidity')
      console.error('removing liquidity failed')
      return false
    }

    tokens = await this.getTokenBalances()
    console.log(
      ' removed liq. got tokens: ' +
        Array.from(tokens.values()).map((value) => ' ' + value.amount + '@' + value.symbol),
    )

    let interestA = new BigNumber(0)
    let interestB = new BigNumber(0)
    if (this.negInterestWorkaround) {
      vault = (await this.getVault()) as LoanVaultActive
      vault.interestAmounts.forEach((value) => {
        if (value.symbol == this.assetA) {
          interestA = new BigNumber(value.amount)
        }
        if (value.symbol == this.assetB) {
          interestB = new BigNumber(value.amount)
        }
      })
    }
    let paybackTokens: AddressToken[] = []
    let collateralTokens: AddressToken[] = []

    let token = tokens.get(this.assetA)
    if (token) {
      if (!this.keepWalletClean) {
        token.amount = '' + BigNumber.min(token.amount, expectedA)
      }
      if (this.negInterestWorkaround && interestA.lt(0)) {
        token.amount = '' + interestA.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback -> send in "wanted + negInterest"
      }
      paybackTokens.push(token)
    }

    token = tokens.get(this.assetB)
    if (token) {
      if (!this.keepWalletClean) {
        token.amount = '' + BigNumber.min(token.amount, expectedB)
      }
      if (this.isSingleMint) {
        collateralTokens.push(token)
      } else {
        if (this.negInterestWorkaround && interestB.lt(0)) {
          token.amount = '' + interestB.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback -> send in "wanted + negInterest"
        }
        paybackTokens.push(token)
      }
    }

    //not instant, but sometimes weird error. race condition? -> use explicit prevout now
    if (await this.paybackTokenBalances(paybackTokens, collateralTokens, telegram, this.prevOutFromTx(removeTx))) {
      await telegram.send('done reducing exposure')
      return true
    }
    return false
  }

  async removeExposure(
    vault: LoanVaultActive,
    pool: PoolPairData,
    balances: Map<string, AddressToken>,
    telegram: Telegram,
    silentOnNothingToDo: boolean = false,
  ): Promise<boolean> {
    let paybackTokens: AddressToken[] = []
    let collateralTokens: AddressToken[] = []
    const lpTokens = balances.get(this.lmPair)
    const assetALoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetA)
    const assetBLoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetB)
    const assetAPerToken = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
    const assetBPerToken = new BigNumber(pool!.tokenB.reserve).div(pool!.totalLiquidity.token)
    if (!assetALoan || (!this.isSingleMint && !assetBLoan) || !lpTokens) {
      console.info("can't withdraw from pool, no tokens left or no loans left")
      if (!silentOnNothingToDo) {
        await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
      }
      return false
    }
    const maxTokenFromAssetA = new BigNumber(assetALoan!.amount).div(assetAPerToken)
    const maxTokenFromAssetB = new BigNumber(assetBLoan?.amount ?? '0').div(assetBPerToken)
    let usedTokens = BigNumber.min(
      lpTokens.amount,
      maxTokenFromAssetA,
      this.isSingleMint ? maxTokenFromAssetA : maxTokenFromAssetB,
    ) //singleMint-> no "restriction" from assetB, can deposit as much as I want
    if (usedTokens.div(0.95).gt(lpTokens.amount)) {
      // usedtokens > lpTokens * 0.95
      usedTokens = new BigNumber(lpTokens.amount) //don't leave dust in the LM
    }
    if (usedTokens.lte(0)) {
      console.info("can't withdraw 0 from pool, no tokens left or no loans left")
      if (!silentOnNothingToDo) {
        await telegram.send("ERROR: can't withdraw 0 pool, no tokens left or no loans left")
      }
      return false
    }

    console.log(
      'removing as much exposure as possible: ' +
        usedTokens.toFixed(5) +
        ' tokens. max from ' +
        this.assetB +
        ': ' +
        maxTokenFromAssetB.toFixed(5) +
        ', max from ' +
        this.assetA +
        ': ' +
        maxTokenFromAssetA.toFixed(5) +
        ' max LPtoken available: ' +
        lpTokens.amount,
    )
    const removeTx = await this.removeLiquidity(+pool!.id, usedTokens)

    await this.updateToState(
      ProgramState.WaitingForTransaction,
      VaultMaxiProgramTransaction.RemoveLiquidity,
      removeTx.txId,
    )

    if (!(await this.waitForTx(removeTx.txId))) {
      await telegram.send('ERROR: when removing liquidity')
      console.error('removing liquidity failed')
      return false
    }
    const tokens = await this.getTokenBalances()
    console.log(
      ' removed liq. got tokens: ' +
        Array.from(tokens.values()).map((value) => ' ' + value.amount + '@' + value.symbol),
    )

    let interestA = new BigNumber(0)
    let interestB = new BigNumber(0)
    if (this.negInterestWorkaround) {
      vault = (await this.getVault()) as LoanVaultActive
      vault.interestAmounts.forEach((value) => {
        if (value.symbol == this.assetA) {
          interestA = new BigNumber(value.amount)
        }
        if (value.symbol == this.assetB) {
          interestB = new BigNumber(value.amount)
        }
      })
    }

    let token = tokens.get(this.assetB)
    if (token) {
      //removing exposure: keep wallet clean
      if (this.isSingleMint) {
        collateralTokens.push(token)
      } else {
        if (this.negInterestWorkaround && interestB.lt(0)) {
          token.amount = '' + interestB.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback, adding extra buffer to include possible additional blocks -> send in "wanted + negInterest"
        }
        paybackTokens.push(token)
      }
    }
    token = tokens.get(this.assetA)
    if (token) {
      //removing exposure: keep wallet clean
      if (this.negInterestWorkaround && interestA.lt(0)) {
        token.amount = '' + interestA.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback -> send in "wanted + negInterest"
      }
      paybackTokens.push(token)
    }

    //not instant, but sometimes weird error. race condition? -> use explicit prevout now
    if (await this.paybackTokenBalances(paybackTokens, collateralTokens, telegram, this.prevOutFromTx(removeTx))) {
      await telegram.send('done removing exposure')
      return true
    }
    return false
  }

  private async paybackTokenBalances(
    loanTokens: AddressToken[],
    collateralTokens: AddressToken[],
    telegram: Telegram,
    prevout: Prevout | undefined = undefined,
  ): Promise<boolean> {
    if (loanTokens.length == 0 && collateralTokens.length == 0) {
      await telegram.send('ERROR: want to pay back, but nothing to do. please check logs')
      console.error('no tokens to pay back or deposit')
      return false
    }
    let waitingTx = undefined
    let triedSomeTx = false
    let used_prevout = prevout
    if (loanTokens.length > 0) {
      console.log(
        ' paying back tokens ' +
          loanTokens.map((token) => ' ' + new BigNumber(token.amount).toFixed(8) + '@' + token.symbol),
      )
      let paybackTokens: TokenBalanceUInt32[] = []
      loanTokens.forEach((addressToken) => {
        let amount = new BigNumber(addressToken.amount)
        if (amount.gt(0)) {
          paybackTokens.push({ token: +addressToken.id, amount: amount })
        } else {
          console.log('negative amount -> not doing anything: ' + amount.toFixed(8) + '@' + addressToken.symbol)
        }
      })
      if (paybackTokens.length > 0) {
        triedSomeTx = true
        const paybackTx = await this.paybackLoans(paybackTokens, used_prevout)
        waitingTx = paybackTx
        used_prevout = this.prevOutFromTx(waitingTx)
        await this.updateToState(
          ProgramState.WaitingForTransaction,
          VaultMaxiProgramTransaction.PaybackLoan,
          waitingTx.txId,
        )
      }
    }
    if (collateralTokens.length > 0) {
      console.log(
        ' depositing tokens ' +
          collateralTokens.map((token) => ' ' + new BigNumber(token.amount).toFixed(8) + '@' + token.symbol),
      )
      for (const collToken of collateralTokens) {
        let amount = new BigNumber(collToken.amount)
        if (amount.gt(0)) {
          triedSomeTx = true
          const depositTx = await this.depositToVault(+collToken.id, amount, used_prevout)
          waitingTx = depositTx
          used_prevout = this.prevOutFromTx(waitingTx)
          await this.updateToState(
            ProgramState.WaitingForTransaction,
            VaultMaxiProgramTransaction.PaybackLoan,
            waitingTx.txId,
          )
        } else {
          console.log('negative amount -> not doing anything: ' + amount.toFixed(8) + '@' + collToken.symbol)
        }
      }
    }

    if (waitingTx != undefined) {
      const success = await this.waitForTx(waitingTx.txId)
      if (!success) {
        await telegram.send('ERROR: paying back tokens')
        console.error('paying back tokens failed')
        return false
      } else {
        console.log('done')
        return true
      }
    } else {
      return !triedSomeTx //didn't even need to do something -> success
    }
  }

  async increaseExposure(
    vault: LoanVaultActive,
    pool: PoolPairData,
    balances: Map<string, AddressToken>,
    telegram: Telegram,
  ): Promise<boolean> {
    console.log('increasing exposure ')

    const additionalLoan = BigNumber.min(
      new BigNumber(vault.collateralValue).div(this.targetCollateral).minus(vault.loanValue),
      new BigNumber(this.nextCollateralValue(vault)).div(this.targetCollateral).minus(this.nextLoanValue(vault)),
    )

    let oracleA: BigNumber
    if (this.assetA == 'DUSD') {
      oracleA = new BigNumber(1)
    } else {
      const oracle = await this.getFixedIntervalPrice(this.assetA)
      if (!oracle.isLive || +(oracle.active?.amount ?? '-1') <= 0) {
        console.warn("No active price for token. can't increase exposure")
        await telegram.send('Could not increase exposure, token has currently no active price')
        return false
      }
      oracleA = new BigNumber(oracle.active?.amount ?? '0')
    }
    let wantedAssetA: BigNumber
    let wantedAssetB: BigNumber
    let prevout
    let loanArray

    let dfiDusdCollateralValue = new BigNumber(0)
    let hasDUSDLoan = vault.loanAmounts.find((loan) => loan.symbol === 'DUSD') !== undefined
    if (this.mainCollateralAsset === 'DFI') {
      hasDUSDLoan = true //if not yet, it will try to take dusd loans
    }
    vault.collateralAmounts.forEach((coll) => {
      if (coll.symbol === 'DFI' || (!hasDUSDLoan && coll.symbol === 'DUSD')) {
        dfiDusdCollateralValue = dfiDusdCollateralValue.plus(this.getUsedOraclePrice(coll, true).times(coll.amount))
      }
    })
    // TODO: check 50%
    if (!this.isSingleMint) {
      wantedAssetA = additionalLoan.div(BigNumber.sum(oracleA, pool.priceRatio.ba))
      wantedAssetB = wantedAssetA.multipliedBy(pool.priceRatio.ba)
      console.log(
        'increasing by ' +
          additionalLoan +
          ' USD, taking loan ' +
          wantedAssetA.toFixed(4) +
          '@' +
          this.assetA +
          ', ' +
          wantedAssetB.toFixed(4) +
          '@' +
          this.assetB,
      )

      loanArray = [
        { token: +pool.tokenA.id, amount: wantedAssetA },
        { token: +pool.tokenB.id, amount: wantedAssetB },
      ]
      //check if enough collateral is there to even take new loan
      //dusdDFI * 2 >= loan+additionLoan * minRatio
      if (
        dfiDusdCollateralValue
          .times(2)
          .lte(additionalLoan.plus(vault.loanValue).times(vault.loanScheme.minColRatio).div(100))
      ) {
        console.error('not enough collateral of DFI or DUSD to take more loans')
        await telegram.send("Wanted to take more loans, but you don't have enough DFI or DUSD in the collateral")
        return false
      }
    } else {
      const coll = vault.collateralAmounts.find((coll) => coll.symbol === this.assetB)
      const oracleB = this.getUsedOraclePrice(coll, true)
      const assetBInColl = coll?.amount ?? '0'

      wantedAssetA = additionalLoan.div(
        BigNumber.sum(oracleA, oracleB.times(pool.priceRatio.ba).div(this.targetCollateral)),
      )
      wantedAssetB = wantedAssetA.multipliedBy(pool.priceRatio.ba)
      console.log(
        'increasing by ' +
          additionalLoan +
          ' USD, taking loan ' +
          wantedAssetA.toFixed(4) +
          '@' +
          this.assetA +
          ', withdrawing ' +
          wantedAssetB.toFixed(4) +
          '@' +
          this.assetB,
      )

      if (!wantedAssetB.lt(assetBInColl)) {
        console.warn(
          'Not enough collateral for single mint. wanted ' + wantedAssetB.toFixed(4) + ' but got only ' + assetBInColl,
        )
        await telegram.send(
          'Could not increase exposure, not enough ' +
            this.assetB +
            ' in collateral to use: ' +
            wantedAssetB.toFixed(4) +
            ' vs. ' +
            assetBInColl,
        )
        return false
      }

      //check if enough collateral is there to even take new loan
      //dusdDFI-assetB * 2 >= loan+additionLoan * minRatio
      if (
        dfiDusdCollateralValue
          .minus(wantedAssetB.times(oracleB))
          .times(2)
          .lte(wantedAssetA.times(oracleA).plus(vault.loanValue).times(vault.loanScheme.minColRatio).div(100))
      ) {
        console.error('not enough collateral of DFI or DUSD to take more loans')
        await telegram.send("Wanted to take more loans, but you don't have enough DFI or DUSD in the collateral")
        return false
      }
      const withdrawTx = await this.withdrawFromVault(+pool.tokenB.id, wantedAssetB)
      await this.updateToState(
        ProgramState.WaitingForTransaction,
        VaultMaxiProgramTransaction.TakeLoan,
        withdrawTx.txId,
      )
      prevout = this.prevOutFromTx(withdrawTx)
      loanArray = [{ token: +pool.tokenA.id, amount: wantedAssetA }]
    }
    const takeLoanTx = await this.takeLoans(loanArray, prevout)
    await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.TakeLoan, takeLoanTx.txId)
    if (this.keepWalletClean) {
      //use full balance to increase exposure: existing balance + expected from loan
      wantedAssetB = wantedAssetB.plus(balances.get(this.assetB)?.amount ?? '0')
      wantedAssetA = wantedAssetA.plus(balances.get(this.assetA)?.amount ?? '0') //upper limit for usedStocks
    }

    let usedAssetB = wantedAssetB
    let usedAssetA = usedAssetB.multipliedBy(pool.priceRatio.ab)
    if (usedAssetA.gt(wantedAssetA)) {
      //not enough stocks to fill it -> use full stocks and reduce DUSD
      usedAssetA = wantedAssetA
      usedAssetB = usedAssetA.multipliedBy(pool.priceRatio.ba)
    }

    console.log(
      ' adding liquidity in same block ' +
        usedAssetA.toFixed(8) +
        '@' +
        this.assetA +
        ' ' +
        usedAssetB.toFixed(8) +
        '@' +
        this.assetB,
    )

    let addTx = await this.addLiquidity(
      [
        { token: +pool.tokenA.id, amount: usedAssetA },
        { token: +pool.tokenB.id, amount: usedAssetB },
      ],
      this.prevOutFromTx(takeLoanTx),
    )

    await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.AddLiquidity, addTx.txId)
    if (!(await this.waitForTx(addTx.txId))) {
      await telegram.send('ERROR: adding liquidity')
      console.error('adding liquidity failed')
      return false
    } else {
      await telegram.send('done increasing exposure')
      console.log('done ')
      return true
    }
  }

  private combineFees(fees: (string | undefined)[]): BigNumber {
    return new BigNumber(fees.reduce((prev, fee) => prev * (1 - +(fee ?? '0')), 1))
  }
  async checkAndDoStableArb(
    vault: LoanVaultActive,
    pool: PoolPairData,
    stableCoinArbBatchSize: number,
    telegram: Telegram,
  ): Promise<boolean> {
    interface PoolRatio {
      ratio: BigNumber
      feeIn: BigNumber //in = swap from other -> DUSD
      feeOut: BigNumber //out = swap from DUSD -> other
      coll: LoanVaultTokenAmount | undefined
      tokenA: { id: string; symbol: string }
      poolsForSwap: PoolId[]
    }
    //get DUSD-DFI, USDT-DFI and USDC-DFI pool
    const poolData = await this.getPools()
    const dusdPool = poolData.find((pool) => pool.symbol === 'DUSD-DFI')
    const usdtPool = poolData.find((pool) => pool.symbol === 'USDT-DFI')
    const usdcPool = poolData.find((pool) => pool.symbol === 'USDC-DFI')

    const usdtPoolDirect = poolData.find((pool) => pool.symbol === 'USDT-DUSD')
    const usdcPoolDirect = poolData.find((pool) => pool.symbol === 'USDC-DUSD')

    if (!dusdPool?.priceRatio.ab || !usdtPool?.priceRatio.ba || !usdcPool?.priceRatio.ba) {
      console.error("couldn't get stable pool data")
      return false
    }

    const usdtColl = vault.collateralAmounts.find((coll) => coll.symbol === 'USDT')
    const usdcColl = vault.collateralAmounts.find((coll) => coll.symbol === 'USDC')
    const dusdColl = vault.collateralAmounts.find((coll) => coll.symbol === 'DUSD')
    const dfiColl = vault.collateralAmounts.find((coll) => coll.symbol === 'DFI')

    let poolRatios: PoolRatio[] = []

    poolRatios.push({
      ratio: new BigNumber(dusdPool.priceRatio.ba).multipliedBy(usdtPool.priceRatio.ab),
      feeIn: this.combineFees([
        usdtPool.tokenA.fee?.inPct,
        usdtPool.tokenB.fee?.outPct,
        dusdPool.tokenB.fee?.inPct,
        dusdPool.tokenA.fee?.outPct,
        usdtPool.commission,
        dusdPool.commission,
      ]),
      feeOut: this.combineFees([
        dusdPool.tokenA.fee?.inPct,
        dusdPool.tokenB.fee?.outPct,
        usdtPool.tokenB.fee?.inPct,
        usdtPool.tokenA.fee?.outPct,
        usdtPool.commission,
        dusdPool.commission,
      ]),
      coll: usdtColl,
      tokenA: usdtPool.tokenA,
      poolsForSwap: [{ id: +usdtPool.id }, { id: +dusdPool.id }],
    })
    poolRatios.push({
      ratio: new BigNumber(dusdPool.priceRatio.ba).multipliedBy(usdcPool.priceRatio.ab),
      feeIn: this.combineFees([
        usdcPool.tokenA.fee?.inPct,
        usdcPool.tokenB.fee?.outPct,
        dusdPool.tokenB.fee?.inPct,
        dusdPool.tokenA.fee?.outPct,
        usdcPool.commission,
        dusdPool.commission,
      ]),
      feeOut: this.combineFees([
        dusdPool.tokenA.fee?.inPct,
        dusdPool.tokenB.fee?.outPct,
        usdcPool.tokenB.fee?.inPct,
        usdcPool.tokenA.fee?.outPct,
        usdcPool.commission,
        dusdPool.commission,
      ]),
      coll: usdcColl,
      tokenA: usdcPool.tokenA,
      poolsForSwap: [{ id: +usdcPool.id }, { id: +dusdPool.id }],
    })

    if (usdtPoolDirect) {
      poolRatios.push({
        ratio: new BigNumber(usdtPoolDirect.priceRatio.ab),
        feeIn: this.combineFees([
          usdtPoolDirect.tokenA.fee?.inPct,
          usdtPoolDirect.tokenB.fee?.outPct,
          usdtPoolDirect.commission,
        ]),
        feeOut: this.combineFees([
          usdtPoolDirect.tokenB.fee?.inPct,
          usdtPoolDirect.tokenA.fee?.outPct,
          usdtPoolDirect.commission,
        ]),
        coll: usdtColl,
        tokenA: usdtPoolDirect.tokenA,
        poolsForSwap: [{ id: +usdtPoolDirect.id }],
      })
    }
    if (usdcPoolDirect) {
      poolRatios.push({
        ratio: new BigNumber(usdcPoolDirect.priceRatio.ab),
        feeIn: this.combineFees([
          usdcPoolDirect.tokenA.fee?.inPct,
          usdcPoolDirect.tokenB.fee?.outPct,
          usdcPoolDirect.commission,
        ]),
        feeOut: this.combineFees([
          usdcPoolDirect.tokenB.fee?.inPct,
          usdcPoolDirect.tokenA.fee?.outPct,
          usdcPoolDirect.commission,
        ]),
        coll: usdcColl,
        tokenA: usdcPoolDirect.tokenA,
        poolsForSwap: [{ id: +usdcPoolDirect.id }],
      })
    }

    const minOffPeg = +(process.env.VAULTMAXI_DUSD_MIN_PEG_DIFF ?? '0.01')
    const pegReference = +(process.env.VAULTMAXI_DUSD_PEG_REF ?? '1')

    let coll: LoanVaultTokenAmount | undefined
    let target: { id: string; symbol: string } | undefined

    poolRatios.sort((b, a) => a.ratio.times(a.feeOut).comparedTo(b.ratio.times(b.feeOut)))
    const maxRatio = poolRatios[0]

    let ratiosmsg = poolRatios
      .map(
        (ratio) =>
          ratio.tokenA.symbol +
          ': ' +
          ratio.ratio.times(ratio.feeOut).toFixed(4) +
          ' (raw: ' +
          ratio.ratio.toFixed(4) +
          ' with fee ratio: ' +
          ratio.feeOut.toFixed(4) +
          ') ' +
          ' via ' +
          ratio.poolsForSwap.length +
          ' pools',
      )
      .join(', ')
    console.log(
      'stable arb for premium: ' +
        ratiosmsg +
        ' vs ' +
        pegReference +
        ' min diff ' +
        minOffPeg +
        '. batchsize: ' +
        stableCoinArbBatchSize,
    )

    let pools: PoolId[] = []
    let maxPrice = pegReference

    const one = new BigNumber(1)
    poolRatios.sort((b, a) => a.feeIn.div(a.ratio).comparedTo(b.feeIn.div(b.ratio)))

    ratiosmsg = poolRatios
      .map(
        (ratio) =>
          ratio.tokenA.symbol +
          ': ' +
          ratio.feeIn.div(ratio.ratio).toFixed(4) +
          ' (raw: ' +
          one.div(ratio.ratio).toFixed(4) +
          ' with fee ratio: ' +
          ratio.feeIn.toFixed(4) +
          ') ' +
          ' via ' +
          ratio.poolsForSwap.length +
          ' pools (' +
          (ratio.coll ? 'got in coll' : 'not in coll') +
          ')',
      )
      .join(', ')
    console.log(
      'stable arb for discount: ' +
        ratiosmsg +
        ' vs ' +
        (1 / pegReference).toFixed(4) +
        ' min diff ' +
        minOffPeg +
        '. batchsize: ' +
        stableCoinArbBatchSize,
    )

    let discountRatios = poolRatios.filter((ratio) => ratio.coll && +ratio.coll.amount > 0)
    const minRatio = discountRatios.length > 0 ? discountRatios[0] : undefined

    if (minRatio && minRatio.feeIn.div(minRatio.ratio).gte(1 / pegReference + minOffPeg)) {
      //discount case: swap stable -> DUSD
      coll = minRatio.coll!
      target = dusdPool.tokenA
      pools = minRatio.poolsForSwap
      console.log(
        'found DUSD discount against ' +
          coll.symbol +
          ': ' +
          minRatio.ratio.toFixed(4) +
          ', ' +
          minRatio.ratio.div(minRatio.feeIn).toFixed(4) +
          ' after fees',
      )
      maxPrice = pegReference
    } else if (
      dusdColl &&
      +dusdColl.amount > 0 &&
      maxRatio.ratio.times(maxRatio.feeOut).gte(pegReference + minOffPeg) && //premium case: swap  DUSD -> stable
      +dusdColl.amount + +(dfiColl?.amount ?? '0') - stableCoinArbBatchSize > +vault.collateralValue * 0.6
    ) {
      //keep buffer in case of market fluctuation
      coll = dusdColl
      target = maxRatio.tokenA
      pools = maxRatio.poolsForSwap
      pools.reverse()
      console.log(
        'found DUSD premium against ' +
          target?.symbol +
          ': ' +
          maxRatio.ratio.toFixed(4) +
          ', ' +
          maxRatio.ratio.times(maxRatio.feeOut).toFixed(4) +
          ' after fees',
      )
      maxPrice = 1 / pegReference
    }

    if (coll && target) {
      const collValue = this.getUsedOraclePrice(coll, true)
      let size = BigNumber.min(new BigNumber(stableCoinArbBatchSize).div(collValue), coll.amount) //safetycheck for batchsize was in coins, need to adapt through value

      let collToken = this.getCollateralToken(target.id)
      let targetValue = collToken
        ? new BigNumber(collToken.activePrice?.active?.amount ?? '1').times(collToken.factor)
        : new BigNumber(1)

      const factorDelta = collValue.minus(targetValue) // > 0 means the new coll is worth less -> need to check that we don't fall too far
      if (factorDelta.gt(0)) {
        //check with collValue to not reduce ratio too much
        const newRatio = new BigNumber(vault.loanValue).div(
          new BigNumber(vault.collateralValue).minus(size.times(factorDelta)),
        )
        const newNextRatio = this.nextLoanValue(vault).div(
          this.nextCollateralValue(vault).minus(size.times(factorDelta)),
        )
        if (BigNumber.min(newRatio, newNextRatio).lt(this.settings.minCollateralRatio / 100)) {
          const usedColl = newRatio.lt(newNextRatio)
            ? new BigNumber(vault.collateralValue)
            : this.nextCollateralValue(vault)
          const usedLoan = newRatio.lt(newNextRatio) ? new BigNumber(vault.loanValue) : this.nextLoanValue(vault)
          size = BigNumber.min(
            size,
            usedColl
              .times(this.settings.minCollateralRatio / 100)
              .minus(usedLoan)
              .div(factorDelta),
          )
          console.log(
            'reduced size due to collFactor differences: ' +
              collValue.toFixed(2) +
              ' to ' +
              targetValue.toFixed(2) +
              '. size reduced to ' +
              size.toFixed(2),
          )
          await telegram.send(
            'stableArb: needed to reduce size due to collValue differences. used size: ' + size.toFixed(2),
          )
        }
      }
      if (size.lte(0)) {
        console.log('size 0 after coll value checks')
        await telegram.send('stableArb: size zero after collValue checks, no stable arb done')
        return false
      }
      console.log('withdrawing ' + size.toFixed(2) + '@' + coll.symbol)
      const withdrawTx = await this.withdrawFromVault(+coll.id, size)
      await this.updateToState(
        ProgramState.WaitingForTransaction,
        VaultMaxiProgramTransaction.StableArbitrage,
        withdrawTx.txId,
      )
      let prevout = this.prevOutFromTx(withdrawTx)
      let swap
      try {
        console.log('swapping ' + size.toFixed(2) + '@' + coll.symbol + ' to ' + target.symbol)
        swap = await this.compositeswap(
          size,
          +coll.id,
          +target.id,
          pools,
          new BigNumber(maxPrice).decimalPlaces(8),
          prevout,
        )
        await this.updateToState(
          ProgramState.WaitingForTransaction,
          VaultMaxiProgramTransaction.StableArbitrage,
          swap.txId,
        )
        prevout = this.prevOutFromTx(swap)
      } catch (e) {
        // error in swap, probably a "price higher than indicated"
        console.warn('error in swap ' + e)
        swap = undefined
      }
      //wait, cause we dont' know how much we make and don't want to leave dust behind
      let lastTx
      let telegrammsg
      if (!swap || !(await this.waitForTx(swap.txId))) {
        //swap failed, pay back
        telegrammsg = 'tried stable arb but failed, ' + (swap ? 'swaptx failed directly.' : "swap didn't go throu.")
        console.info(telegrammsg + ' redepositing ' + size.toFixed(2) + '@' + coll.symbol)
        lastTx = await this.depositToVault(+coll.id, size, prevout)
      } else {
        const balance = await this.getTokenBalance(target.symbol)
        telegrammsg =
          'did stable arb. got ' +
          balance?.amount +
          '@' +
          target?.symbol +
          ' for ' +
          size.toFixed(4) +
          '@' +
          coll.symbol
        console.info(telegrammsg + ', depositing ' + balance?.amount + '@' + target.symbol)
        lastTx = await this.depositToVault(+target.id, new BigNumber(balance!.amount), prevout)
      }
      await this.updateToState(
        ProgramState.WaitingForTransaction,
        VaultMaxiProgramTransaction.StableArbitrage,
        lastTx.txId,
      )
      await this.waitForTx(lastTx.txId)
      await telegram.send(telegrammsg)

      return true
    } else {
      return false
    }
  }

  async sendMotivationalLog(
    vault: LoanVaultActive,
    pool: PoolPairData,
    donatedAmount: BigNumber,
    telegram: Telegram,
  ): Promise<void> {
    if (this.targetCollateral > 2.5) {
      console.info('target collateral above 250%')
      return //TODO: send message that user could maximize further?
    }
    const referenceRatio = this.targetCollateral < 1.8 ? 250 : 300
    if (!pool?.apr) {
      //no data, not motivation
      console.warn('no pool apr in motivational log')
      return
    }

    const neededrepayForRefRatio = BigNumber.max(
      new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).dividedBy(referenceRatio / 100)),
      this.nextLoanValue(vault).minus(this.nextCollateralValue(vault).div(referenceRatio / 100)),
    )

    const oracleA = this.getUsedOraclePrice(
      vault.loanAmounts.find((l) => l.symbol === this.assetA),
      false,
    )
    let wantedTokens: BigNumber
    let oracleB = new BigNumber(1)
    if (!this.isSingleMint) {
      wantedTokens = neededrepayForRefRatio.div(BigNumber.sum(oracleA.times(pool.tokenA.reserve), pool.tokenB.reserve)) //would be oracleB* pool!.tokenB.reserve but oracleB is always 1 for DUSD as loan
    } else {
      oracleB = this.getUsedOraclePrice(
        vault.collateralAmounts.find((coll) => coll.symbol === this.assetB),
        true,
      )
      wantedTokens = neededrepayForRefRatio.times(referenceRatio / 100).div(
        BigNumber.sum(
          oracleA.times(pool.tokenA.reserve).times(referenceRatio / 100), //additional "times" due to part collateral, part loan
          oracleB.times(pool.tokenB.reserve),
        ),
      )
    }

    const loanDiff = wantedTokens.times(
      BigNumber.sum(oracleA.times(pool.tokenA.reserve), oracleB.times(pool.tokenB.reserve)),
    )
    //for double mint it would be the same, but single mint is more complex
    //const loanDiff = (+vault.collateralValue) * (1 / this.targetCollateral - 100 / referenceRatio)
    const rewardDiff = loanDiff.toNumber() * pool.apr.total
    if (rewardDiff < 100) {
      console.info('small rewardDiff ' + rewardDiff.toFixed(2) + ' -> no motivation')
      return //just a testvault, no need to motivate anyone
    }
    let rewardMessage: string
    if (rewardDiff > 100 * 365) {
      rewardMessage = '$' + (rewardDiff / 365).toFixed(0) + ' in rewards per day'
    } else if (rewardDiff > 100 * 52) {
      rewardMessage = '$' + (rewardDiff / 52).toFixed(0) + ' in rewards per week'
    } else if (rewardDiff > 100 * 12) {
      rewardMessage = '$' + (rewardDiff / 12).toFixed(0) + ' in rewards per month'
    } else {
      rewardMessage = '$' + rewardDiff.toFixed(0) + ' in rewards per year'
    }
    const message =
      'With VaultMaxi you currently earn additional ' +
      rewardMessage +
      ' (compared to using ' +
      referenceRatio +
      '% collateral ratio).\n' +
      (donatedAmount.gt(0)
        ? 'Thank your for donating ' + donatedAmount.toFixed(3) + ' DFI!'
        : 'You are very welcome.\nDonations are always appreciated!')
    if (!isNullOrEmpty(telegram.chatId) && !isNullOrEmpty(telegram.token)) {
      await telegram.send(message)
    } else {
      await telegram.log(message)
    }
  }

  async checkAndDoReinvest(
    vault: LoanVaultActive,
    pool: PoolPairData,
    balances: Map<String, AddressToken>,
    telegram: Telegram,
  ): Promise<boolean> {
    if (!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
      return false
    }

    const utxoBalance = await this.getUTXOBalance()
    const tokenBalance = balances.get('DFI')

    const amountFromBalance = new BigNumber(tokenBalance?.amount ?? '0')
    const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
    let amountToUse = fromUtxos.plus(amountFromBalance)

    let prevout: Prevout | undefined = undefined
    console.log(
      'checking for reinvest: ' +
        fromUtxos +
        ' from UTXOs, ' +
        amountFromBalance +
        ' tokens. total ' +
        amountToUse +
        ' vs ' +
        this.settings.reinvestThreshold,
    )
    if (amountToUse.gt(this.settings.reinvestThreshold) && fromUtxos.gt(0)) {
      console.log('converting ' + fromUtxos + ' UTXOs to token ')
      const tx = await this.utxoToOwnAccount(fromUtxos)
      await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
      prevout = this.prevOutFromTx(tx)
    }

    if (amountToUse.gt(this.settings.reinvestThreshold)) {
      let donatedAmount = new BigNumber(0)
      let dfiCollateral = vault.collateralAmounts.find((coll) => coll.symbol === 'DFI')
      let dfiPrice = dfiCollateral?.activePrice?.active?.amount
      let maxReinvestForDonation = this.settings.reinvestThreshold
      if (dfiPrice && pool.apr) {
        //35040 executions per year -> this is the expected reward per maxi trigger in DFI, every reinvest below that number is pointless
        maxReinvestForDonation = Math.max(
          maxReinvestForDonation,
          (+vault.loanValue * pool.apr.reward) / (35040 * +dfiPrice),
        )
      } else {
        maxReinvestForDonation = Math.max(maxReinvestForDonation, 10) //fallback to min 10 DFI reinvest
      }
      maxReinvestForDonation *= 2 //anything above twice the expected reinvest value is considered a transfer of funds
      if (this.settings.autoDonationPercentOfReinvest > 0 && amountToUse.lt(maxReinvestForDonation)) {
        //send donation and reduce amountToUse
        donatedAmount = amountToUse.times(this.settings.autoDonationPercentOfReinvest).div(100)
        console.log('donating ' + donatedAmount.toFixed(2) + ' DFI')
        const donationAddress = this.walletSetup.isTestnet() ? DONATION_ADDRESS_TESTNET : DONATION_ADDRESS
        const tx = await this.sendDFIToAccount(donatedAmount, donationAddress, prevout)
        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
        prevout = this.prevOutFromTx(tx)

        amountToUse = amountToUse.minus(donatedAmount)
      }
      console.log(
        'reinvest targets (' +
          this.reinvestTargets.length +
          '):\n' +
          this.reinvestTargets
            .map(
              (target) =>
                target.percent!.toFixed(1) +
                '% ' +
                (target.targetAddress !== undefined
                  ? 'sending to ' + target.targetAddress
                  : target.isCollateral
                  ? 'reinvesting'
                  : 'swapping to wallet') +
                ' as ' +
                target.tokenName,
            )
            .reduce((a, b) => a + '\n' + b),
      )

      let finalTx: CTransaction | undefined = undefined

      let toBeSent: Map<string, { to: Script; balances: TokenBalanceUInt32[] }> = new Map()
      let sentTokens = []
      let reinvestAmounts = []
      let swappedAmounts = []

      let allTokens = await this.listTokens()
      const dfiTargets = this.reinvestTargets.filter((target) => target.tokenName === 'DFI')
      const nondfiTargets = this.reinvestTargets.filter((target) => target.tokenName !== 'DFI')
      let reinvestOrSend: {
        tokenId: number
        inputAmount: BigNumber
        estimatedResult: BigNumber
        usedDFI: BigNumber
        target: ReinvestTarget
      }[] = []
      for (const target of dfiTargets) {
        let inputAmount = amountToUse.times(target.percent! / 100)
        reinvestOrSend.push({
          tokenId: 0,
          inputAmount: inputAmount,
          estimatedResult: inputAmount,
          usedDFI: inputAmount,
          target: target,
        })
      }

      for (const target of nondfiTargets) {
        let inputAmount = amountToUse.times(target.percent! / 100)
        const usedDFI = inputAmount
        let tokenId = 0
        //have to swap and wait
        let token = this.getCollateralTokenByKey(target.tokenName)?.token
        if (token === undefined) {
          token = allTokens.find((t) => t.symbolKey === target.tokenName)
        }
        if (token === undefined) {
          const msg = 'could not find token ' + target.tokenName + ' in reinvest. skipping this target'
          console.warn(msg)
          await telegram.send(msg)
          continue
        }
        tokenId = +token.id
        const path = await this.client.poolpairs.getBestPath('0', token.id)
        //TODO: maybe get all paths and choose best manually?
        console.log('swaping ' + inputAmount + 'DFI to ' + target.tokenName)
        const swap = await this.compositeswap(
          inputAmount,
          0,
          tokenId,
          path.bestPath.map((pair) => {
            return { id: +pair.poolPairId }
          }),
          new BigNumber(999999999),
          prevout,
        )
        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, swap.txId)
        prevout = this.prevOutFromTx(swap)
        finalTx = swap
        reinvestOrSend.push({
          tokenId: tokenId,
          inputAmount: inputAmount,
          estimatedResult: inputAmount.times(path.estimatedReturn),
          usedDFI: usedDFI,
          target: target,
        })
      }
      if (finalTx != undefined) {
        console.log('sent swaps, waiting for them to get confirmed before continuing')
      }
      if (finalTx != undefined && !(await this.waitForTx(finalTx.txId))) {
        await telegram.send('ERROR: swapping reinvestment failed')
        console.error('swapping reinvestment failed')
        //throw error?
        return true
      }

      for (const t of reinvestOrSend) {
        if (t.tokenId !== 0) {
          t.inputAmount = BigNumber.min(
            t.estimatedResult,
            (await this.getTokenBalances()).get(t.target.tokenName)!.amount,
          )
          console.log('got ' + t.inputAmount.toFixed(4) + ' ' + t.target.tokenName + ' to use after swap')
        }
        if (t.target.targetScript !== undefined) {
          console.log('sending ' + t.inputAmount + ' ' + t.target.tokenName + ' to ' + t.target.targetAddress)
          if (t.target.tokenName === 'DFI') {
            //send as UTXO
            const tx = await this.accountToUTXO(t.inputAmount, t.target.targetScript, prevout) //converts and sends in one tx
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
            prevout = this.prevOutFromTx(tx)
            finalTx = tx
          } else {
            if (!toBeSent.has(t.target.targetAddress!)) {
              toBeSent.set(t.target.targetAddress!, { to: t.target.targetScript, balances: [] })
            }
            toBeSent.get(t.target.targetAddress!)?.balances.push({
              token: t.tokenId,
              amount: t.inputAmount,
            })
            //const tx = await this.accountToAccount(inputAmount, target.targetScript, prevout) //converts and sends in one tx
            //await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
          }
          sentTokens.push(
            (t.target.tokenName !== 'DFI' ? t.usedDFI.toFixed(2) + '@DFI=>' : '') +
              t.inputAmount.toFixed(4) +
              '@' +
              t.target.tokenName +
              '=>' +
              t.target.targetAddress!,
          )
        } else if (t.target.isCollateral) {
          //deposit
          console.log('depositing ' + t.inputAmount + ' ' + t.target.tokenName + ' to vault ')
          const tx = await this.depositToVault(t.tokenId, t.inputAmount, prevout)
          await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
          prevout = this.prevOutFromTx(tx)
          finalTx = tx
          reinvestAmounts.push(
            (t.target.tokenName !== 'DFI' ? t.usedDFI.toFixed(2) + '@DFI => ' : '') +
              t.inputAmount.toFixed(4) +
              '@' +
              t.target.tokenName,
          )
        } else {
          swappedAmounts.push(
            (t.target.tokenName !== 'DFI' ? t.usedDFI.toFixed(2) + '@DFI=>' : '') +
              t.inputAmount.toFixed(4) +
              '@' +
              t.target.tokenName,
          )
        }
      }
      if (toBeSent.size > 0) {
        let targets: { to: Script; balances: TokenBalanceUInt32[] }[] = []
        let msg = ''
        toBeSent.forEach((value, target) => {
          targets.push(value)
          msg +=
            target +
            ': ' +
            value.balances
              .map((balance) => balance.amount.toFixed(4) + '@' + balance.token)
              .reduce((a, b) => a + ',' + b)
        })
        console.log('sending tokens ' + msg)
        const tx = await this.sendTokenToAccounts(targets, prevout)
        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
        prevout = this.prevOutFromTx(tx)
        finalTx = tx
      }

      if (finalTx !== undefined && !(await this.waitForTx(finalTx.txId))) {
        await telegram.send('ERROR: reinvestment tx failed, please check')
        console.error('final reinvest tx failed')
      } else {
        let msg =
          'reinvested ' +
          amountToUse.toFixed(4) +
          '@DFI' +
          ' (' +
          amountFromBalance.toFixed(4) +
          ' DFI tokens, ' +
          fromUtxos.toFixed(4) +
          ' UTXOs, minus ' +
          donatedAmount.toFixed(4) +
          ' donation)\n'
        if (reinvestAmounts.length > 0) {
          msg += 'reinvested:\n' + reinvestAmounts.reduce((a, b) => a + '\n' + b) + '\n'
        }
        if (swappedAmounts.length > 0) {
          msg += 'swapped:\n' + swappedAmounts.reduce((a, b) => a + '\n' + b) + '\n'
        }
        if (sentTokens.length > 0) {
          msg += 'sent:\n' + sentTokens.reduce((a, b) => a + '\n' + b) + '\n'
        }

        await telegram.send(msg)
        console.log('done ')
        await this.sendMotivationalLog(vault, pool, donatedAmount, telegram)
        if (this.settings.autoDonationPercentOfReinvest > 0 && donatedAmount.lte(0)) {
          console.log('sending manual donation suggestion')
          await telegram.send(
            'you activated auto donation, but the reinvested amount was too big to be a reinvest. ' +
              'We assume that this was a transfer of funds, so we skipped auto-donation. ' +
              'Feel free to manually donate anyway.',
          )
        }
      }
      return true
    }

    return false
  }

  async cleanUp(
    vault: LoanVaultActive,
    balances: Map<string, AddressToken>,
    telegram: Telegram,
    safetyMode: boolean = false,
  ): Promise<boolean> {
    let wantedTokens: AddressToken[] = []
    let mainAssetAsLoan = false

    vault.loanAmounts.forEach((loan) => {
      if (loan.symbol == this.mainCollateralAsset) {
        mainAssetAsLoan = true
      }
      let token = balances.get(loan.symbol)
      if (token) {
        if (this.negInterestWorkaround) {
          const interest = new BigNumber(
            vault.interestAmounts.find((interest) => interest.symbol == loan.symbol)?.amount ?? '0',
          )
          if (interest.lt(0)) {
            token.amount = '' + interest.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback -> send in "wanted + negInterest"
          }
        }
        if (safetyMode) {
          token.amount = '' + +token.amount / 2 //last cleanup failed -> try with half the amount
        }
        let enoughValue = true
        const estimatedValue = new BigNumber(token.amount).times(loan.activePrice?.active?.amount ?? 1)
        if (token.symbol != 'DUSD' && loan.activePrice?.active === undefined) {
          enoughValue = true //no oracle? better pay back cause can't say if its worth anything
        } else {
          //do not use balances below 10 cent value -> would just waste fees
          enoughValue = estimatedValue.gte(this.minValueForCleanup)
        }
        console.log(
          'cleanup ' + token.symbol + ' estimated ' + estimatedValue.toFixed(2) + ' USD, will clean: ' + enoughValue,
        )
        if (enoughValue) {
          wantedTokens.push(token)
        }
      }
    })
    let collTokens: AddressToken[] = []
    if (this.isSingleMint && !mainAssetAsLoan) {
      //if there is a loan of the main asset, first pay back the loan
      let token = balances.get(this.mainCollateralAsset)
      if (token) {
        console.log('cleanup to collateral ' + token.amount + '@' + token.symbol)
        if (+token.amount > this.minValueForCleanup) {
          //main collateralAsset is DFI or DUSD. don't cleanup less than 10cent or 0.1 DFI
          collTokens.push(token)
        }
      }
    }
    if (wantedTokens.length == 0 && collTokens.length == 0) {
      console.log('No tokens to pay back. nothing to clean up')
      return true // not an error
    } else {
      return await this.paybackTokenBalances(wantedTokens, collTokens, telegram)
    }
  }

  async updateToState(state: ProgramState, transaction: VaultMaxiProgramTransaction, txId: string = ''): Promise<void> {
    return await this.store.updateToState({
      state: state,
      tx: transaction,
      txId: txId,
      blockHeight: await this.getBlockHeight(),
      version: VERSION,
    })
  }
}

