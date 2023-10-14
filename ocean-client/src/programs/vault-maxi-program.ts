import {
  LoanVaultActive,
  LoanVaultLiquidated,
  LoanVaultState,
  LoanVaultTokenAmount,
} from '@defichain/whale-api-client/dist/api/loan'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { LogLevel, nameFromLogLevel, prefixFromLogLevel, Telegram } from '../utils/telegram'
import { CommonProgram, ProgramState } from './common-program'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { WalletSetup } from '../utils/wallet-setup'
import { AddressToken } from '@defichain/whale-api-client/dist/api/address'
import { PoolId, TokenBalanceUInt32 } from '@defichain/jellyfish-transaction'
import { simplifyAddress } from '../utils/helpers'
import { Prevout } from '@defichain/jellyfish-transaction-builder'

import { VERSION } from '../vault-maxi'
import { IStoreMaxi, StoredMaxiSettings } from '../utils/store_aws_maxi'
import {
  checkAndDoReinvest,
  checkReinvestTargets,
  DONATION_MAX_PERCENTAGE,
  getReinvestMessage,
  initReinvestTargets,
  ReinvestTarget,
} from '../utils/reinvestor'
import { ActivePrice } from '@defichain/whale-api-client/dist/api/prices'

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
      (this.vault ? 'monitoring vault ' + simplifyAddress(this.vault) : 'no vault found') +
      '\n' +
      (this.address ? 'from address ' + simplifyAddress(this.address) : 'no valid address') +
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

export class VaultMaxiProgram extends CommonProgram {
  private targetCollateral: number
  readonly lmPair: string
  readonly assetA: string
  readonly assetB: string
  private mainCollateralAsset: string
  private isSingleMintA: boolean
  private isSingleMintB: boolean
  private readonly keepWalletClean: boolean
  private readonly minValueForCleanup: number = 1
  private readonly maxPercentDiffInConsistencyChecks: number = 1

  private negInterestWorkaround: boolean = false
  public readonly dusdTokenId: number

  private reinvestTargets: ReinvestTarget[] = []

  private readonly STABLE_COINS = ["USDT", "USDC", "EUROC", "XCHF"]

  constructor(maxiStore: IStoreMaxi, settings: StoredMaxiSettings, walletSetup: WalletSetup) {
    super(maxiStore, settings, walletSetup)
    this.dusdTokenId = walletSetup.isTestnet() ? 11 : 15
    this.lmPair = this.getSettings().LMPair
    ;[this.assetA, this.assetB] = this.lmPair.split('-')
    this.mainCollateralAsset = this.getSettings().mainCollateralAsset
    this.isSingleMintB = this.assetB == "DUSD" && this.STABLE_COINS.indexOf(this.assetA) >= 0
    this.isSingleMintA = !this.isSingleMintB && (this.mainCollateralAsset == 'DUSD' || this.lmPair == 'DUSD-DFI')

    this.targetCollateral = (this.getSettings().minCollateralRatio + this.getSettings().maxCollateralRatio) / 200
    this.keepWalletClean =
      (process.env.VAULTMAXI_KEEP_CLEAN ? process.env.VAULTMAXI_KEEP_CLEAN !== 'false' : settings.keepWalletClean) ??
      true
    this.minValueForCleanup = +(process.env.VAULTMAXI_MINVALUE_CLEANUP ?? 1)
  }

  private getSettings(): StoredMaxiSettings {
    return this.settings as StoredMaxiSettings
  }

  getVersion(): string {
    return VERSION
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
        this.getCollateralFactor('' + this.dusdTokenId).toFixed(3) +
        ' min value for cleanup is $' +
        this.minValueForCleanup.toFixed(2),
    )
    let pattern = this.getSettings().reinvestPattern
    if (pattern === undefined || pattern === '') {
      //no pattern provided? pattern = "<mainCollateralAsset>" if should swap, else "DFI"
      pattern = process.env.VAULTMAXI_SWAP_REWARDS_TO_MAIN !== 'false' ?? true ? this.mainCollateralAsset : 'DFI'
    }
    this.reinvestTargets = await initReinvestTargets(pattern, this)

    return result
  }

  static shouldCleanUpBasedOn(transaction: VaultMaxiProgramTransaction): boolean {
    return (
      transaction == VaultMaxiProgramTransaction.RemoveLiquidity || transaction == VaultMaxiProgramTransaction.TakeLoan
    )
  }

  getVaultId(): string {
    return this.getSettings().vault
  }

  targetRatio(): number {
    return this.targetCollateral
  }

  getMintingMessage(): string {
    return (this.isSingleMintA ? 'minting only ' + this.assetA : (this.isSingleMintB ? "minting only" + this.assetB : 'minting both assets'))
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

  getUsedOraclePrice(token: { symbol: string, activePrice?: ActivePrice, id: string } | undefined, isCollateral: boolean): BigNumber {
    if (token === undefined) {
      return new BigNumber(0)
    }
    let oraclePrice
    if (token.symbol === 'DUSD') {
      oraclePrice = new BigNumber(1)
    } else {
      if (isCollateral) {
        oraclePrice = BigNumber.min(token.activePrice?.active?.amount ?? 0, token.activePrice?.next?.amount ?? 0)
      } else {
        oraclePrice = BigNumber.max(token.activePrice?.active?.amount ?? 1, token.activePrice?.next?.amount ?? 1)
      }
    }
    if (isCollateral) {
      return oraclePrice.times(this.getCollateralFactor(token.id))
    } else {
      return oraclePrice
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
        'Could not find vault. ' +
        'trying vault ' +
        this.getSettings().vault +
        ' in ' +
        this.getSettings().address +
        '. '
      await telegram.send(message, LogLevel.ERROR)
      return false
    }
    if (vaultcheck.ownerAddress !== this.getSettings().address) {
      const message = 'Error: vault not owned by this address'
      await telegram.send(message, LogLevel.ERROR)
      return false
    }
    if (vaultcheck.state === LoanVaultState.IN_LIQUIDATION) {
      const message = "Error: Can't maximize a vault in liquidation!"
      await telegram.send(message, LogLevel.ERROR)
      return false
    }
    if (this.assetB != 'DUSD' && this.lmPair != 'DUSD-DFI') {
      const message = 'vaultMaxi only works on dStock-DUSD pools or DUSD-DFI not on ' + this.lmPair
      await telegram.send(message, LogLevel.ERROR)
      return false
    }
    if (!pool) {
      const message = 'No pool found for this token. tried: ' + this.lmPair
      await telegram.send(message, LogLevel.ERROR)
      return false
    }

    const utxoBalance = await this.getUTXOBalance()
    if (utxoBalance.lte(1e-4)) {
      //1 tx is roughly 2e-6 fee, one action mainly 3 tx -> 6e-6 fee. we want at least 10 actions safety -> below 1e-4 we warn
      if (utxoBalance.lte(0)) {
        //can't work with no UTXOs
        const message =
          '!!!IMMEDIATE ACTION REQUIRED!!!\n' +
          'you have no UTXOs left in ' +
          this.getSettings().address +
          ". Please replenish otherwise you maxi can't protect your vault!"
        await telegram.send(message, LogLevel.CRITICAL)
        return false
      }
      const message =
        '!!!ACTION REQUIRED!!!\n' +
        'your UTXO balance is running low in ' +
        this.getSettings().address +
        ', only ' +
        utxoBalance.toFixed(5) +
        ' DFI left. Please replenish to prevent any errors'
      await telegram.send(message, LogLevel.WARNING)
      console.warn(message)
    }
    // showstoppers checked, now check for warnings or automatic adaptions

    if (+vaultcheck.loanScheme.minColRatio >= this.getSettings().minCollateralRatio) {
      const message =
        'minCollateralRatio is too low. ' +
        'thresholds ' +
        this.getSettings().minCollateralRatio +
        ' - ' +
        this.getSettings().maxCollateralRatio +
        '. loanscheme minimum is ' +
        vaultcheck.loanScheme.minColRatio +
        ' will use ' +
        (+vaultcheck.loanScheme.minColRatio + 1) +
        ' as minimum'
      await telegram.send(message, LogLevel.WARNING)
      this.getSettings().minCollateralRatio = +vaultcheck.loanScheme.minColRatio + 1
    }

    const minRange = 2
    if (
      this.getSettings().maxCollateralRatio > 0 &&
      this.getSettings().minCollateralRatio > this.getSettings().maxCollateralRatio - minRange
    ) {
      const message =
        'Min collateral must be more than ' +
        minRange +
        ' below max collateral. Please change your settings. ' +
        'thresholds ' +
        this.getSettings().minCollateralRatio +
        ' - ' +
        this.getSettings().maxCollateralRatio +
        ' will use ' +
        this.getSettings().minCollateralRatio +
        ' - ' +
        (this.getSettings().minCollateralRatio + minRange)
      await telegram.send(message, LogLevel.WARNING)
      this.getSettings().maxCollateralRatio = this.getSettings().minCollateralRatio + minRange
    }
    this.targetCollateral = (this.getSettings().minCollateralRatio + this.getSettings().maxCollateralRatio) / 200

    if (this.mainCollateralAsset != 'DUSD' && this.mainCollateralAsset != 'DFI') {
      const message = "can't use this main collateral: " + this.mainCollateralAsset + '. falling back to DFI'
      await telegram.send(message, LogLevel.WARNING)
      this.mainCollateralAsset = 'DFI'
    }
    if (this.mainCollateralAsset != 'DFI' && this.assetB != this.mainCollateralAsset) {
      const message =
        "can't work with this combination of mainCollateralAsset " +
        this.mainCollateralAsset +
        ' and lmPair ' +
        this.lmPair
      await telegram.send(message, LogLevel.WARNING)
      this.mainCollateralAsset = 'DFI'
    }

    this.isSingleMintB = this.assetB == "DUSD" && this.STABLE_COINS.indexOf(this.assetA) >= 0
    this.isSingleMintA = !this.isSingleMintB && (this.mainCollateralAsset == 'DUSD' || this.lmPair == 'DUSD-DFI')

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
        const ALoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetA)
        const BLoan = vault.loanAmounts.find((loan) => loan.symbol == this.assetB)
        if (!lpTokens || (!this.isSingleMintB && !ALoan) || (!this.isSingleMintA && !BLoan)) {
          const message =
            '!!!IMMEDIATE ACTION REQUIRED!!!\n' +
            'There are no lpTokens in the address or no according loans in the vault.\n' +
            'Did you change the LMToken? VaultMaxi is NOT ABLE TO WORK! Your vault is NOT safe! '
          await telegram.send(message, LogLevel.CRITICAL)
        } else {
          const safeRatio = safeCollRatio / 100
          const neededrepay = new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).div(safeRatio))
          const safetyLevel = await this.calcSafetyLevel(vault, pool, balances)
          let message =
            `VaultMaxi could only reach a collRatio of ${safetyLevel.toFixed(0)}%. This is not safe!\n` +
            'It is highly recommend to fix this!\n' +
            `To be able to reach a safe collRatio of ${safeCollRatio.toFixed(0)}% it\n`
          if (this.isSingleMintA) {
            let oracleA = this.getUsedOraclePrice(ALoan, false)
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
            if (neededLPtokens.gt(lpTokens.amount) || neededAssetA.gt(ALoan!.amount)) {
              message +=
                `would need ${neededLPtokens.toFixed(4)} but got ${(+lpTokens.amount).toFixed(4)} ${
                  lpTokens.symbol
                }.\n` +
              `would need ${neededAssetA.toFixed(4)} but got ${(+ALoan!.amount).toFixed(4)} ${ALoan!.symbol}.\n`

              await telegram.send(message, LogLevel.WARNING) //warning or error? action is recommended but not required?
            }
          } else if (this.isSingleMintB) {
            // case stable-DUSD
            let oracleB = new BigNumber(1)
            let tokenA = this.getCollateralTokenByKey(this.assetA)!
            let oracleA = this.getUsedOraclePrice({ symbol: tokenA.token.symbolKey, id: tokenA.tokenId, activePrice: tokenA.activePrice }, true)


            const neededLPtokens = neededrepay
              .times(safeRatio)
              .times(pool.totalLiquidity.token)
              .div(
                BigNumber.sum(oracleA.times(pool.tokenA.reserve), oracleB.times(pool.tokenB.reserve).times(safeRatio)),
              )

            const neededAssetB = neededLPtokens.times(pool.tokenB.reserve).div(pool.totalLiquidity.token)
            if (neededLPtokens.gt(lpTokens.amount) || neededAssetB.gt(ALoan!.amount)) {
              message +=
                `would need ${neededLPtokens.toFixed(4)} but got ${(+lpTokens.amount).toFixed(4)} ${lpTokens.symbol
                }.\n` +
                `would need ${neededAssetB.toFixed(4)} but got ${(+BLoan!.amount).toFixed(4)} ${BLoan!.symbol}.\n`

              await telegram.send(message, LogLevel.WARNING) //warning or error? action is recommended but not required?
            }

          } else {
            //case dToken-DUSD
            const neededStock = neededrepay.div(
              BigNumber.sum(this.getUsedOraclePrice(ALoan, false), pool!.priceRatio.ba),
            )
            const neededDusd = neededStock.multipliedBy(pool!.priceRatio.ba)
            const stock_per_token = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
            const neededLPtokens = neededStock.div(stock_per_token)
            if (
              neededLPtokens.gt(lpTokens.amount) ||
              neededDusd.gt(BLoan!.amount) ||
              neededStock.gt(ALoan!.amount)
            ) {
              message +=
                `would need ${neededLPtokens.toFixed(4)} but got ${(+lpTokens.amount).toFixed(4)} ${lpTokens.symbol
                }.\n` +
                `would need ${neededDusd.toFixed(1)}  but got ${(+dusdLoan!.amount).toFixed(1)}  ${dusdLoan!.symbol
                }.\n` +
                `would need ${neededStock.toFixed(4)} but got ${(+tokenLoan!.amount).toFixed(4)} ${tokenLoan!.symbol}.\n`
              await telegram.send(message, LogLevel.WARNING) //@krysh is this warning or error?
            }
          }
        }
      }
    }

    // sanity check for auto-donate feature, do NOT allow auto-donate above our defined max percentage
    this.getSettings().autoDonationPercentOfReinvest = Math.min(
      this.getSettings().autoDonationPercentOfReinvest,
      DONATION_MAX_PERCENTAGE,
    )

    //check reinvest pattern
    if (!(await checkReinvestTargets(this.reinvestTargets, telegram))) {
      this.reinvestTargets = []
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
    if (!lpTokens || (!this.isSingleMintB && !assetALoan) || (!this.isSingleMintA && !assetBLoan)) {
      return new BigNumber(0)
    }
    const assetAPerToken = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
    let usedAssetA = assetAPerToken.multipliedBy(lpTokens.amount)
    let maxRatioNum: BigNumber
    let maxRatioDenom: BigNumber

    if (this.isSingleMintA) {
      const oracleA = this.getUsedOraclePrice(assetALoan, false)
      const oracleB = this.getUsedOraclePrice(
        vault.collateralAmounts.find((coll) => coll.symbol == this.assetB),
        true,
      )
      let usedLpTokens = new BigNumber(lpTokens.amount)
      if (usedAssetA.gt(assetALoan!.amount)) {
        usedAssetA = new BigNumber(assetALoan!.amount)
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
    } else if (this.isSingleMintB) {
      // case  stable-DUSD
      let oracleB = new BigNumber(1)
      let tokenA = this.getCollateralTokenByKey(this.assetA)!
      let oracleA = this.getUsedOraclePrice({ symbol: tokenA.token.symbolKey, id: tokenA.tokenId, activePrice: tokenA.activePrice }, true)

      let usedLpTokens = new BigNumber(lpTokens.amount)
      let usedAssetB = usedAssetA.multipliedBy(pool!.priceRatio.ba)

      if (usedAssetB.gt(assetBLoan!.amount)) {
        usedAssetB = new BigNumber(assetBLoan!.amount)
        usedAssetA = usedAssetB.multipliedBy(pool!.priceRatio.ab)
      }

      console.log(
        'could use up to ' +
        usedLpTokens.toFixed(8) +
        ' LP Tokens leading to payback of ' +
        usedAssetB.toFixed(4) +
        '@' +
        this.assetB,
      )

      const lpPerTL = usedLpTokens.dividedBy(pool.totalLiquidity.token)
      maxRatioNum = BigNumber.sum(lpPerTL.times(pool.tokenA.reserve).times(oracleA), vault.collateralValue)
      maxRatioDenom = new BigNumber(vault.loanValue).minus(lpPerTL.times(pool.tokenB.reserve).times(oracleB))
    } else {
      const tokenOracle = this.getUsedOraclePrice(assetALoan, false)
      let usedAssetB = usedAssetA.multipliedBy(pool!.priceRatio.ba)
      if (usedAssetA.gt(assetALoan!.amount)) {
        usedAssetA = new BigNumber(assetALoan!.amount)
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
    }  

    if (maxRatioDenom.lt(1)) {
      return new BigNumber(99999)
    }
    return maxRatioNum.div(maxRatioDenom).multipliedBy(100)
  }

  async doAndReportCheck(telegram: Telegram, oceansToUse: string[]): Promise<boolean> {
    if (!this.doValidationChecks(telegram, true)) {
      return false //report already send inside
    }
    var values = new CheckedValues()

    let walletAddress = this.getAddress()
    let vault = await this.getVault()
    let pool = await this.getPool(this.lmPair)

    values.address = walletAddress === this.getSettings().address ? walletAddress : undefined
    values.vault =
      vault?.vaultId === this.getSettings().vault && vault.ownerAddress == walletAddress ? vault.vaultId : undefined
    values.minCollateralRatio = this.getSettings().minCollateralRatio
    values.maxCollateralRatio = this.getSettings().maxCollateralRatio

    values.assetA = pool && pool.symbol == this.lmPair ? this.assetA : undefined
    values.assetB = values.assetA ? this.assetB : undefined
    if (this.assetB != 'DUSD' && this.lmPair != 'DUSD-DFI') {
      values.assetA = values.assetB = undefined
    }
    values.reinvest = this.getSettings().reinvestThreshold

    const message =
      values.constructMessage() +
      '\n' +
      (this.keepWalletClean ? 'trying to keep the wallet clean' : 'ignoring dust and commissions') +
      '\n' +
      this.getMintingMessage() +
      '\nmain collateral asset is ' +
      this.mainCollateralAsset +
      getReinvestMessage(this.reinvestTargets, this.getSettings(), this) +
      '\n' +
      (this.getSettings().stableCoinArbBatchSize > 0
        ? 'searching for arbitrage with batches of size ' + this.getSettings().stableCoinArbBatchSize
        : 'not searching for stablecoin arbitrage') +
      '\nusing ocean at: ' +
      this.walletSetup.url +
      (oceansToUse.length > 0 ? ' with fallbacks: ' + oceansToUse.reduce((p, c) => p + ',' + c) : '') +
      `\nloglevel: ${prefixFromLogLevel(this.getSettings().logLevel)} ${nameFromLogLevel(this.getSettings().logLevel)}`

    console.log(message)
    console.log('using telegram for log: ' + telegram.logToken + ' chatId: ' + telegram.logChatId)
    console.log('using telegram for notification: ' + telegram.token + ' chatId: ' + telegram.chatId)
    await telegram.send(message, LogLevel.ERROR) //highest level for notifications
    await telegram.send('log channel active', LogLevel.VERBOSE) //lowest level for logs

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
      await telegram.send('ERROR: invalid reduce calculation. please check', LogLevel.ERROR)
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
    if (lptokens.lte(0) || (!this.isSingleMintB && assetALoan.lte(0)) || (!this.isSingleMintA && assetBLoan.lte(0))) {
      await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left", LogLevel.ERROR)
      return false
    }
    let wantedTokens: BigNumber
    if (this.isSingleMintA) {
      let oracleB = this.getUsedOraclePrice(
        vault.collateralAmounts.find((coll) => coll.symbol == this.assetB),
        true
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
    } else if (this.isSingleMintB) {
      // stable-DUSD
      let oracleB = new BigNumber(1) //DUSD in loans is fixed 1
      let tokenA = this.getCollateralTokenByKey(this.assetA)!
      oracleA = this.getUsedOraclePrice({ symbol: tokenA.token.symbolKey, id: tokenA.tokenId, activePrice: tokenA.activePrice }, true)

      wantedTokens = neededrepay
        .times(this.targetCollateral)
        .times(pool.totalLiquidity.token)
        .div(
          BigNumber.sum(
            oracleA.times(pool.tokenA.reserve),
            oracleB.times(pool.tokenB.reserve).times(this.targetCollateral), //additional "times" due to part collateral, part loan
          ),
        )
    } else {
      wantedTokens = neededrepay
        .times(pool!.totalLiquidity.token)
        .div(BigNumber.sum(oracleA.times(pool.tokenA.reserve), pool.tokenB.reserve)) //would be oracleB* pool!.tokenB.reserve but oracleB is always 1 for DUSD as loan, and we do not have other double mints
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
      await telegram.send('ERROR: when removing liquidity', LogLevel.ERROR)
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
      if (this.isSingleMintB) {
        collateralTokens.push(token)
      } else {
        if (this.negInterestWorkaround && interestA.lt(0)) {
          token.amount = '' + interestA.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback -> send in "wanted + negInterest"
        }
        paybackTokens.push(token)
      }
    }

    token = tokens.get(this.assetB)
    if (token) {
      if (!this.keepWalletClean) {
        token.amount = '' + BigNumber.min(token.amount, expectedB)
      }
      if (this.isSingleMintA) {
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
      await telegram.send('done reducing exposure', LogLevel.INFO)
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
    if ((!this.isSingleMintB && !assetALoan) || (!this.isSingleMintA && !assetBLoan) || !lpTokens) {
      console.info("can't withdraw from pool, no tokens left or no loans left")
      if (!silentOnNothingToDo) {
        await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left", LogLevel.ERROR)
      }
      return false
    }
    const maxTokenFromAssetA = new BigNumber(assetALoan?.amount ?? 0).div(assetAPerToken)
    const maxTokenFromAssetB = new BigNumber(assetBLoan?.amount ?? 0).div(assetBPerToken)
    let usedTokens = BigNumber.min(
      lpTokens.amount,
      this.isSingleMintB ? maxTokenFromAssetB : maxTokenFromAssetA,
      this.isSingleMintA ? maxTokenFromAssetA : maxTokenFromAssetB, //TODO: check this
    ) //singleMint-> no "restriction" from assetB, can deposit as much as I want
    if (usedTokens.div(0.95).gt(lpTokens.amount)) {
      // usedtokens > lpTokens * 0.95
      usedTokens = new BigNumber(lpTokens.amount) //don't leave dust in the LM
    }
    if (usedTokens.lte(0)) {
      console.info("can't withdraw 0 from pool, no tokens left or no loans left")
      if (!silentOnNothingToDo) {
        await telegram.send("ERROR: can't withdraw 0 pool, no tokens left or no loans left", LogLevel.ERROR)
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
      await telegram.send('ERROR: when removing liquidity', LogLevel.ERROR)
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
      if (this.isSingleMintA) {
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
      if (this.isSingleMintB) {
        collateralTokens.push(token)
      } else {
        if (this.negInterestWorkaround && interestA.lt(0)) {
          token.amount = '' + interestA.times(1.005).plus(token.amount) //neg interest with the bug is implicitly added to the payback -> send in "wanted + negInterest"
        }
        paybackTokens.push(token)
      }
    }

    //not instant, but sometimes weird error. race condition? -> use explicit prevout now
    if (await this.paybackTokenBalances(paybackTokens, collateralTokens, telegram, this.prevOutFromTx(removeTx))) {
      await telegram.send('done removing exposure', LogLevel.INFO)
      return true
    }
    return false
  }

  private async paybackTokenBalances(
    loanTokens: AddressToken[],
    collateralTokens: AddressToken[],
    telegram: Telegram,
    prevout: Prevout | undefined = undefined,
    oneByOne: boolean = false,
  ): Promise<boolean> {
    if (loanTokens.length == 0 && collateralTokens.length == 0) {
      await telegram.send('ERROR: want to pay back, but nothing to do. please check logs', LogLevel.WARNING)
      return false
    }
    let waitingTx = undefined
    let triedSomeTx = false
    let used_prevout = prevout
    let error = undefined
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

        if (!oneByOne) {
          const paybackTx = await this.paybackLoans(paybackTokens, used_prevout)
          waitingTx = paybackTx
          used_prevout = this.prevOutFromTx(waitingTx)
          await this.updateToState(
            ProgramState.WaitingForTransaction,
            VaultMaxiProgramTransaction.PaybackLoan,
            waitingTx.txId,
          )
        } else {
          for (const payback of paybackTokens) {
            try {
              const paybackTx = await this.paybackLoans([payback], used_prevout)
              waitingTx = paybackTx
              used_prevout = this.prevOutFromTx(waitingTx)
              await this.updateToState(
                ProgramState.WaitingForTransaction,
                VaultMaxiProgramTransaction.PaybackLoan,
                waitingTx.txId,
              )
            } catch (e) {
              error = e
              console.error('Error paying back tokens one by one. will try next one')
              console.error(e)
            }
          }
        }
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
          try {
            const depositTx = await this.depositToVault(+collToken.id, amount, undefined, used_prevout)
            waitingTx = depositTx
            used_prevout = this.prevOutFromTx(waitingTx)
            await this.updateToState(
              ProgramState.WaitingForTransaction,
              VaultMaxiProgramTransaction.PaybackLoan,
              waitingTx.txId,
            )
          } catch (e) {
            error = e
            console.error('Error depositing tokens. will try next one')
            console.error(e)
          }
        } else {
          console.log('negative amount -> not doing anything: ' + amount.toFixed(8) + '@' + collToken.symbol)
        }
      }
    }
    let result = false
    if (waitingTx != undefined) {
      const success = await this.waitForTx(waitingTx.txId)
      if (!success) {
        await telegram.send('ERROR: paying back tokens', LogLevel.ERROR)
        result = false
      } else {
        console.log('payback done')
        result = true
      }
    } else {
      result = !triedSomeTx //didn't even need to do something -> success
    }
    if (error) {
      throw error //waited if any other payback worked, no throw to know outside something is wrong
    }
    return result
  }

  //returns [successfull, didChangeExposure]
  // successfull = false would mean we need a cleanUp
  
  async increaseExposure(
    vault: LoanVaultActive,
    pool: PoolPairData,
    balances: Map<string, AddressToken>,
    telegram: Telegram,
  ): Promise<[boolean,boolean]> {
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
        await telegram.send('Could not increase exposure, token has currently no active price. Will try again later', LogLevel.INFO)
        return [true,false]
      }
      oracleA = new BigNumber(oracle.active?.amount ?? '0')
    }
    let wantedAssetA: BigNumber
    let wantedAssetB: BigNumber
    let prevout
    let loanArray

    let dfiDusdCollateralValue = new BigNumber(0)
    let hasDUSDLoan = vault.loanAmounts.find((loan) => loan.symbol === 'DUSD') !== undefined
    if (this.mainCollateralAsset === 'DFI' || (this.isSingleMintB && this.assetB == "DUSD")) {
      hasDUSDLoan = true //if not yet, it will try to take dusd loans
    }
    vault.collateralAmounts.forEach((coll) => {
      if (coll.symbol === 'DFI' || (!hasDUSDLoan && coll.symbol === 'DUSD')) {
        dfiDusdCollateralValue = dfiDusdCollateralValue.plus(this.getUsedOraclePrice(coll, true).times(coll.amount))
      }
    })
    if (this.isSingleMintA) {
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

      if (wantedAssetB.gt(assetBInColl)) {
        //check whats possible and increase till there
        if (oracleB.times(assetBInColl).lt(1)) {
          //don't mess around for possible rounding errors
          const msg =
            'Could not increase exposure, not enough ' +
            this.assetB +
            ' in collateral to use: ' +
            wantedAssetB.toFixed(4) +
            ' vs. ' +
            assetBInColl
          await telegram.send(msg, LogLevel.WARNING)
          return  [true,false]
        }
        const msg =
          "Wanted to increase exposure, but you don't have enough of " +
          this.assetB +
          ' in the collateral. Wanted to take ' +
          wantedAssetB.toFixed(4) +
          ' will only take ' +
          assetBInColl
        await telegram.send(msg, LogLevel.INFO)

        wantedAssetB = BigNumber.min(wantedAssetB, assetBInColl)
        wantedAssetA = wantedAssetB.multipliedBy(pool.priceRatio.ab)
      }

      //check if enough collateral is there to even take new loan
      //dusdDFI-assetB * 2 >= loan+additionLoan * minRatio
      //assetB is only taken from DusdDFI if B is DFI or there are no DUSD loans,
      //  otherwise (B == DUSD && has DusdLoans) DUSD didn't count to the dusdDFI in the first place
      const availableDFIDusd =
        this.assetB === 'DFI' || !hasDUSDLoan
          ? dfiDusdCollateralValue.minus(wantedAssetB.times(oracleB))
          : dfiDusdCollateralValue
      if (
        availableDFIDusd
          .times(2)
          .lte(wantedAssetA.times(oracleA).plus(vault.loanValue).times(vault.loanScheme.minColRatio).div(100))
      ) {
        //check whats possible and increase till there
        //(availableDfiDusd)*2 >= (loan + assetA*oracleA)*minRatio
        // -> assetA <= ((availableDfiDusd)*2/minRatio - loan)/oracleA
        const maxAssetA = wantedAssetA
        //need min in case that it was reduced due to B in collateral before
        wantedAssetA = BigNumber.min(
          wantedAssetA,
          availableDFIDusd
            .times(200 / +vault.loanScheme.minColRatio)
            .minus(vault.loanValue)
            .div(oracleA),
        )
        wantedAssetB = wantedAssetA.multipliedBy(pool.priceRatio.ba)

        if (wantedAssetB.times(oracleB).lt(1)) {
          //don't mess around for possible rounding errors
          await telegram.send(
            `Wanted to take more loans, but you don't have enough ${
              hasDUSDLoan ? 'DFI' : 'DFI or DUSD'
            } in the collateral`,
            LogLevel.WARNING,
          )
          return  [true,false]
        }

        const msg =
          "Wanted to take more loans, but you don't have enough DFI or DUSD in the collateral. Wanted to take " +
          maxAssetA.toFixed(2) +
          ' will only take ' +
          wantedAssetA.toFixed(2) +
          ' of ' +
          this.assetA
        await telegram.send(msg, LogLevel.INFO)
      }
      const withdrawTx = await this.withdrawFromVault(+pool.tokenB.id, wantedAssetB)
      await this.updateToState(
        ProgramState.WaitingForTransaction,
        VaultMaxiProgramTransaction.TakeLoan,
        withdrawTx.txId,
      )
      prevout = this.prevOutFromTx(withdrawTx)
      loanArray = [{ token: +pool.tokenA.id, amount: wantedAssetA }]
    } else if (this.isSingleMintB) {
      // add stable-DUSD case
      let oracleB = new BigNumber(1) //DUSD in loans is fixed 1

      const coll = vault.collateralAmounts.find((coll) => coll.symbol === this.assetB)
      const oracleA = this.getUsedOraclePrice(coll, true)
      const assetAInColl = coll?.amount ?? '0'

      wantedAssetB = additionalLoan.div(
        BigNumber.sum(oracleB, oracleA.times(pool.priceRatio.ab).div(this.targetCollateral)),
      )
      wantedAssetA = wantedAssetB.multipliedBy(pool.priceRatio.ab)
      console.log(
        'increasing by ' +
        additionalLoan +
        ' USD, taking loan ' +
        wantedAssetB.toFixed(4) +
        '@' +
        this.assetB +
        ', withdrawing ' +
        wantedAssetA.toFixed(4) +
        '@' +
        this.assetA,
      )

      if (wantedAssetA.gt(assetAInColl)) {
        //check whats possible and increase till there
        if (oracleA.times(assetAInColl).lt(1)) {
          //don't mess around for possible rounding errors
          const msg =
            'Could not increase exposure, not enough ' +
            this.assetA +
            ' in collateral to use: ' +
            wantedAssetA.toFixed(4) +
            ' vs. ' +
            assetAInColl
          await telegram.send(msg, LogLevel.WARNING)
          return [true, false]
        }
        const msg =
          "Wanted to increase exposure, but you don't have enough of " +
          this.assetA +
          ' in the collateral. Wanted to take ' +
          wantedAssetA.toFixed(4) +
          ' will only take ' +
          assetAInColl
        await telegram.send(msg, LogLevel.INFO)

        wantedAssetA = BigNumber.min(wantedAssetA, assetAInColl)
        wantedAssetB = wantedAssetA.multipliedBy(pool.priceRatio.ba)
      }

      //check if enough collateral is there to even take new loan
      //dusdDFI * 2 >= loan+additionLoan * minRatio
      if (
        dfiDusdCollateralValue
          .times(2)
          .lte(wantedAssetB.times(oracleB).plus(vault.loanValue).times(vault.loanScheme.minColRatio).div(100))
      ) {
        //check whats possible and increase till there
        //(availableDfiDusd)*2 >= (loan + assetB*oracleB)*minRatio
        // -> assetB <= ((availableDfiDusd)*2/minRatio - loan)/oracleB
        const maxAssetB = wantedAssetB
        //need min in case that it was reduced due to B in collateral before
        wantedAssetB = BigNumber.min(
          wantedAssetB,
          dfiDusdCollateralValue
            .times(200 / +vault.loanScheme.minColRatio)
            .minus(vault.loanValue)
            .div(oracleB),
        )
        wantedAssetA = wantedAssetB.multipliedBy(pool.priceRatio.ab)

        if (wantedAssetB.times(oracleB).lt(1)) {
          //don't mess around for possible rounding errors
          await telegram.send(
            `Wanted to take more loans, but you don't have enough ${hasDUSDLoan ? 'DFI' : 'DFI or DUSD'
            } in the collateral`,
            LogLevel.WARNING,
          )
          return [true, false]
        }

        const msg =
          "Wanted to take more loans, but you don't have enough DFI or DUSD in the collateral. Wanted to take " +
          maxAssetB.toFixed(2) +
          ' will only take ' +
          wantedAssetB.toFixed(2) +
          ' of ' +
          this.assetB
        await telegram.send(msg, LogLevel.INFO)
      }
      const withdrawTx = await this.withdrawFromVault(+pool.tokenA.id, wantedAssetA)
      await this.updateToState(
        ProgramState.WaitingForTransaction,
        VaultMaxiProgramTransaction.TakeLoan,
        withdrawTx.txId,
      )
      prevout = this.prevOutFromTx(withdrawTx)
      loanArray = [{ token: +pool.tokenB.id, amount: wantedAssetB }]
    } else {
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
        //check whats possible and increase till there
        const possibleLoan = dfiDusdCollateralValue
          .times(2)
          .div(+vault.loanScheme.minColRatio / 100)
          .minus(vault.loanValue)
        if (possibleLoan.lt(1)) {
          //don't mess around for possible rounding errors
          await telegram.send(
            "Wanted to take more loans, but you don't have enough DFI in the collateral",
            LogLevel.WARNING,
          )
          return [true, false]
        }
        const msg =
          "Wanted to take more loans, but you don't have enough DFI or DUSD in the collateral. Wanted to take " +
          additionalLoan.toFixed(2) +
          ' will only take ' +
          possibleLoan.toFixed(2)
        await telegram.send(msg, LogLevel.INFO)
        wantedAssetA = possibleLoan.div(BigNumber.sum(oracleA, pool.priceRatio.ba))
        wantedAssetB = wantedAssetA.multipliedBy(pool.priceRatio.ba)
      }
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
      undefined,
      this.prevOutFromTx(takeLoanTx),
    )

    await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.AddLiquidity, addTx.txId)
    if (!(await this.waitForTx(addTx.txId))) {
      await telegram.send('ERROR: adding liquidity', LogLevel.ERROR)
      return  [false,true]
    } else {
      await telegram.send('done increasing exposure', LogLevel.INFO)
      return [true,true]
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
        if (BigNumber.min(newRatio, newNextRatio).lt(this.getSettings().minCollateralRatio / 100)) {
          const usedColl = newRatio.lt(newNextRatio)
            ? new BigNumber(vault.collateralValue)
            : this.nextCollateralValue(vault)
          const usedLoan = newRatio.lt(newNextRatio) ? new BigNumber(vault.loanValue) : this.nextLoanValue(vault)
          size = BigNumber.min(
            size,
            usedColl
              .times(this.getSettings().minCollateralRatio / 100)
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
            LogLevel.WARNING,
          )
        }
      }
      if (size.lte(0)) {
        await telegram.send('stableArb: size zero after collValue checks, no stable arb done', LogLevel.WARNING)
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
          undefined,
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
        lastTx = await this.depositToVault(+coll.id, size, undefined, prevout)
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
        lastTx = await this.depositToVault(+target.id, new BigNumber(balance!.amount), undefined, prevout)
      }
      await this.updateToState(
        ProgramState.WaitingForTransaction,
        VaultMaxiProgramTransaction.StableArbitrage,
        lastTx.txId,
      )
      await this.waitForTx(lastTx.txId)
      await telegram.send(telegrammsg, LogLevel.INFO)

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
    if (this.isSingleMintA) {
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
    } else if (this.isSingleMintB) {
      //TODO: stalbe-DUSD case
      wantedTokens = new BigNumber(0)
    } else {
      wantedTokens = neededrepayForRefRatio.div(BigNumber.sum(oracleA.times(pool.tokenA.reserve), pool.tokenB.reserve)) //would be oracleB* pool!.tokenB.reserve but oracleB is always 1 for DUSD as loan
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
    await telegram.send(message, LogLevel.INFO)
  }

  async checkAndDoReinvest(
    vault: LoanVaultActive,
    pool: PoolPairData,
    balances: Map<string, AddressToken>,
    telegram: Telegram,
  ): Promise<boolean> {
    let dfiCollateral = vault.collateralAmounts.find((coll) => coll.symbol === 'DFI')
    let dfiPrice = dfiCollateral?.activePrice?.active?.amount
    let maxReinvestForDonation = this.getSettings().reinvestThreshold ?? 0
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

    const result = await checkAndDoReinvest(
      maxReinvestForDonation,
      balances,
      telegram,
      this,
      this.getSettings(),
      this.reinvestTargets,
    )

    if (result.didReinvest) {
      await this.sendMotivationalLog(vault, pool, result.donatedAmount, telegram)
    }
    return result.addressChanged
  }

  async cleanUp(
    vault: LoanVaultActive,
    balances: Map<string, AddressToken>,
    telegram: Telegram,
    previousTries: number = 0,
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
        }
        if (previousTries > 1) {
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
    if (this.isSingleMintA && !mainAssetAsLoan) {
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
      return await this.paybackTokenBalances(wantedTokens, collTokens, telegram, undefined, previousTries > 0)
    }
  }

  async updateToState(state: ProgramState, transaction: VaultMaxiProgramTransaction, txId: string = ''): Promise<void> {
    return await (this.store as IStoreMaxi).updateToState({
      state: state,
      tx: transaction,
      txId: txId,
      blockHeight: await this.getBlockHeight(),
      version: VERSION,
    })
  }
}
