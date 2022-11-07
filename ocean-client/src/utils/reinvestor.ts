import { CTransaction, Script } from '@defichain/jellyfish-transaction/dist'
import { CommonProgram, ProgramState } from '../programs/common-program'
import { VaultMaxiProgram } from '../programs/vault-maxi-program'
import { simplifyAddress } from './helpers'
import { fromAddress } from '@defichain/jellyfish-address'
import { LoanVaultActive } from '@defichain/whale-api-client/dist/api/loan'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { AddressToken } from '@defichain/whale-api-client/dist/api/address'
import { Telegram } from './telegram'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { Prevout } from '@defichain/jellyfish-transaction-builder'

export const DONATION_ADDRESS = 'df1qqtlz4uw9w5s4pupwgucv4shl6atqw7xlz2wn07'
export const DONATION_ADDRESS_TESTNET = 'tZ1GuasY57oin5cej1Wp3MA1pAE4y3tmzq'
export const DONATION_MAX_PERCENTAGE = 50

enum ReinvestTargetTokenType {
  DFI,
  Token,
  LPToken,
}

enum ReinvestTargetType {
  Wallet,
  Vault,
}

class TargetWallet {
  public readonly address: string
  public readonly script: Script | undefined

  constructor(address: string, script: Script | undefined) {
    this.address = address
    this.script = script
  }

  getLogMessage(program: CommonProgram) {
    return this.address === program.getAddress() ? 'swapping to wallet' : 'sending to ' + simplifyAddress(this.address)
  }
}

class TargetVault {
  public readonly vaultId: string

  constructor(vaultId: string) {
    this.vaultId = vaultId
  }

  getLogMessage(program: CommonProgram) {
    return this.vaultId === program.getVaultId() ? 'reinvesting' : 'depositing to ' + simplifyAddress(this.vaultId)
  }
}

export enum ReinvestTransaction {
  Swap = 'ReinvestSwap',
  DepositOrLM = 'ReinvestDepositOrLM',
}

export interface IReinvestSettings {
  reinvestThreshold: number | undefined
  reinvestPattern: string | undefined
  autoDonationPercentOfReinvest: number
}

export class ReinvestTarget {
  tokenName: string
  percent: number | undefined
  tokenType: ReinvestTargetTokenType
  target: TargetVault | TargetWallet | undefined

  constructor(tokenName: string, percent: number | undefined, target: TargetVault | TargetWallet | undefined) {
    this.tokenName = tokenName
    this.percent = percent
    this.target = target
    this.tokenType =
      tokenName === 'DFI'
        ? ReinvestTargetTokenType.DFI
        : tokenName.indexOf('-') > 0
        ? ReinvestTargetTokenType.LPToken
        : ReinvestTargetTokenType.Token
  }

  getType() {
    if (this.target === undefined) {
      return undefined
    }
    return this.target instanceof TargetWallet ? ReinvestTargetType.Wallet : ReinvestTargetType.Vault
  }
}

export function getReinvestMessage(
  reinvestTargets: ReinvestTarget[],
  settings: IReinvestSettings,
  program: CommonProgram,
): string {
  const reinvestMsg =
    reinvestTargets.length > 0
      ? 'reinvest Targets:\n  ' +
        reinvestTargets
          .map(
            (target) =>
              target.percent!.toFixed(1) + '% ' + target.target!.getLogMessage(program) + ' as ' + target.tokenName,
          )
          .reduce((a, b) => a + '\n  ' + b)
      : 'no reinvest targets -> no reinvest'

  const autoDonationMessage =
    settings.autoDonationPercentOfReinvest > DONATION_MAX_PERCENTAGE
      ? 'Thank you for donating ' +
        DONATION_MAX_PERCENTAGE +
        '% of your rewards. You set to donate ' +
        settings.autoDonationPercentOfReinvest +
        '% which is great but feels like an input error. Donation was reduced to ' +
        DONATION_MAX_PERCENTAGE +
        '% of your reinvest. Feel free to donate more manually'
      : 'Thank you for donating ' + settings.autoDonationPercentOfReinvest + '% of your rewards'

  return (
    '\n' +
    (settings.reinvestThreshold ?? -1 > 0 ? reinvestMsg : 'not reinvesting') +
    '\n' +
    (settings.autoDonationPercentOfReinvest > 0 ? autoDonationMessage : 'auto donation is turned off')
  )
}

export async function initReinvestTargets(pattern: string, program: CommonProgram): Promise<ReinvestTarget[]> {
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
  let reinvestTargets: ReinvestTarget[] = []
  let totalPercent = 0
  let targetsWithNoPercent = 0
  const vaultRegex = /^[a-f0-9]{64}$/i
  const scriptPerAddress: Map<string, Script | undefined> = new Map()
  pattern!.split(' ').forEach((t) => {
    const parts = t.split(':')
    const tokenName = parts[0]
    const percent = parts.length > 1 ? parts[1] : ''
    const address = parts.length > 2 ? parts[2] : ''
    const token = program.getCollateralTokenByKey(tokenName)
    const isCollateral = token !== undefined
    let percentValue = undefined
    if (percent === '') {
      targetsWithNoPercent++
    } else {
      percentValue = +percent
      totalPercent += percentValue
    }
    let target = undefined
    if (address !== '') {
      let usedAddress = address
      if (usedAddress === 'wallet') {
        usedAddress = program.getAddress()
      }
      if (usedAddress === 'vault') {
        usedAddress = program.getVaultId()
      }
      if (vaultRegex.test(usedAddress)) {
        //is vault address
        if (isCollateral) {
          target = new TargetVault(usedAddress)
        } else {
          console.warn('vault target for non-collateral token: ' + t)
        }
      } else {
        //no vaultId, check for normal address
        if (!scriptPerAddress.has(usedAddress)) {
          scriptPerAddress.set(usedAddress, fromAddress(usedAddress, program.getNetwork().name)?.script)
        }
        target = new TargetWallet(usedAddress, scriptPerAddress.get(usedAddress))
      }
    } else {
      //no target defined -> fallback to own address or vault
      if (isCollateral) {
        target = new TargetVault(program.getVaultId())
      } else {
        target = new TargetWallet(program.getAddress(), program.getScript()!)
      }
    }
    reinvestTargets.push(new ReinvestTarget(tokenName, percentValue, target))
  })

  const remainingPercent = totalPercent < 100 ? (100 - totalPercent) / targetsWithNoPercent : 0
  for (const target of reinvestTargets) {
    if (target.percent === undefined) {
      target.percent = remainingPercent
    }
  }
  reinvestTargets = reinvestTargets.filter((t) => t.percent! > 0)
  console.log('got ' + reinvestTargets.length + ' targets with ' + totalPercent + ' defined percent.')
  return reinvestTargets
}

export async function checkReinvestTargets(reinvestTargets: ReinvestTarget[], telegram: Telegram) {
  let totalSum = 0
  let reinvestError = false
  for (const target of reinvestTargets) {
    if (target.target === undefined) {
      const message = 'invalid reinvest target, likely a vault target with non-collateral asset. please check logs'
      await telegram.send(message)
      console.warn(message)
      reinvestError = true
    } else if (target.getType() === ReinvestTargetType.Wallet && (target.target as TargetWallet).script === undefined) {
      const message = 'reinvest target address ' + (target.target as TargetWallet).address + ' is not valid'
      await telegram.send(message)
      console.warn(message)
      reinvestError = true
    }
    if (target.percent! < 0 || target.percent! > 100) {
      const message = 'invalid percent (' + target.percent + ') in reinvest target ' + target.tokenName
      await telegram.send(message)
      console.warn(message)
      reinvestError = true
    }
    totalSum += target.percent!
  }
  totalSum = Math.round(totalSum)
  if (totalSum != 100) {
    const message = 'sum of reinvest targets is not 100%. Its ' + totalSum
    await telegram.send(message)
    console.warn(message)
    reinvestError = true
  }
  if (reinvestError) {
    const message = 'will not do any reinvest until errors are fixed'
    await telegram.send(message)
    console.warn(message)
    return false
  }
  return true
}

async function swapDFIForReinvest(
  amount: BigNumber,
  targetToken: { id: string; symbol: string },
  targetScript: Script | undefined,
  prevout: Prevout | undefined,
  program: CommonProgram,
): Promise<[CTransaction, BigNumber]> {
  const path = await program.client.poolpairs.getBestPath('0', targetToken.id)
  //TODO: maybe get all paths and choose best manually?
  console.log('swaping ' + amount + 'DFI to ' + targetToken.symbol)
  const swap = await program.compositeswap(
    amount,
    0,
    +targetToken.id,
    path.bestPath.map((pair) => {
      return { id: +pair.poolPairId }
    }),
    new BigNumber(999999999),
    targetScript,
    prevout,
  )
  return [swap, amount.times(path.estimatedReturn)]
}

export async function checkAndDoReinvest(
  maxReinvestForDonation: number,
  balances: Map<string, AddressToken>,
  telegram: Telegram,
  program: CommonProgram,
  settings: IReinvestSettings,
  reinvestTargets: ReinvestTarget[],
): Promise<{ addressChanged: boolean; didReinvest: boolean; donatedAmount: BigNumber }> {
  if (!settings.reinvestThreshold || settings.reinvestThreshold <= 0 || reinvestTargets.length == 0) {
    return { addressChanged: false, didReinvest: false, donatedAmount: new BigNumber(0) }
  }

  const utxoBalance = await program.getUTXOBalance()
  const tokenBalance = balances.get('DFI')

  const amountFromBalance = new BigNumber(tokenBalance?.amount ?? '0')
  const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
  let amountToUse = fromUtxos.plus(amountFromBalance)

  let finalTx: CTransaction | undefined = undefined
  let prevout: Prevout | undefined = undefined
  console.log(
    'checking for reinvest: ' +
      fromUtxos +
      ' from UTXOs, ' +
      amountFromBalance +
      ' tokens. total ' +
      amountToUse +
      ' vs ' +
      settings.reinvestThreshold,
  )
  if (amountToUse.lt(settings.reinvestThreshold)) {
    return { addressChanged: false, didReinvest: false, donatedAmount: new BigNumber(0) }
  }

  if (fromUtxos.gt(0)) {
    console.log('converting ' + fromUtxos + ' UTXOs to token ')
    finalTx = await program.utxoToOwnAccount(fromUtxos)
    prevout = program.prevOutFromTx(finalTx)
  }

  let donatedAmount = new BigNumber(0)
  if (settings.autoDonationPercentOfReinvest > 0 && amountToUse.lt(maxReinvestForDonation)) {
    //send donation and reduce amountToUse
    donatedAmount = amountToUse.times(settings.autoDonationPercentOfReinvest).div(100)
    console.log('donating ' + donatedAmount.toFixed(2) + ' DFI')
    const donationAddress = program.isTestnet() ? DONATION_ADDRESS_TESTNET : DONATION_ADDRESS
    finalTx = await program.sendDFIToAccount(donatedAmount, donationAddress, prevout)
    prevout = program.prevOutFromTx(finalTx)
    amountToUse = amountToUse.minus(donatedAmount)
  }

  //reinvesting the defined DFI amount according to targets now
  console.log(
    'reinvest targets (' +
      reinvestTargets.length +
      '):\n' +
      reinvestTargets
        .map(
          (target) =>
            target.percent!.toFixed(1) + '% ' + target.target!.getLogMessage(program) + ' as ' + target.tokenName,
        )
        .reduce((a, b) => a + '\n' + b),
  )

  let allTokens = await program.listTokens()
  let allPools = await program.getPools()
  let dfiTargets: ReinvestTarget[] = []
  let nondfiTargets: ReinvestTarget[] = []
  let lpTargets: ReinvestTarget[] = []

  //for logs
  let sentTokens: Map<string, string[]> = new Map()
  let depositTokens: Map<string, string[]> = new Map()

  //fill data structures
  reinvestTargets
    .filter((t) => t.target != undefined)
    .forEach((t) => {
      switch (t.getType()) {
        case ReinvestTargetType.Wallet:
          const address = (t.target as TargetWallet).address
          if (!sentTokens.has(address)) sentTokens.set(address, [])
          break
        case ReinvestTargetType.Vault:
          const vault = (t.target as TargetVault).vaultId
          if (!depositTokens.has(vault)) depositTokens.set(vault, [])
          break
      }
      switch (t.tokenType) {
        case ReinvestTargetTokenType.DFI:
          dfiTargets.push(t)
          break
        case ReinvestTargetTokenType.Token:
          nondfiTargets.push(t)
          break
        case ReinvestTargetTokenType.LPToken:
          lpTargets.push(t)
          break
      }
    })

  let toDeposit: {
    tokenId: number
    inputAmount: BigNumber
    estimatedResult: BigNumber
    usedDFI: BigNumber
    target: ReinvestTarget
  }[] = []

  let toAddtoLM: {
    pool: PoolPairData
    estimatedResultA: BigNumber
    estimatedResultB: BigNumber
    usedDFI: BigNumber
    target: ReinvestTarget
  }[] = []

  for (const target of dfiTargets) {
    let inputAmount = amountToUse.times(target.percent! / 100)
    if (target.getType() === ReinvestTargetType.Wallet) {
      console.log('sending ' + inputAmount.toFixed(2) + ' DFI as UTXOs')
      finalTx = await program.accountToUTXO(inputAmount, (target.target as TargetWallet).script!, prevout) //converts and sends in one tx
      prevout = program.prevOutFromTx(finalTx)
      sentTokens.get((target.target as TargetWallet).address)!.push(inputAmount.toFixed(2) + '@DFI')
    } else {
      toDeposit.push({
        tokenId: 0,
        inputAmount: inputAmount,
        estimatedResult: inputAmount,
        usedDFI: inputAmount,
        target: target,
      })
    }
  }

  const swappedSymbol = '\u{27a1}'

  //handle normal token swaps, possible deposit to vault done in a second step
  for (const target of nondfiTargets) {
    let inputAmount = amountToUse.times(target.percent! / 100)
    const usedDFI = inputAmount
    //have to swap and wait in case of reinvest
    let token = program.getCollateralTokenByKey(target.tokenName)?.token
    if (token === undefined) {
      token = allTokens.find((t) => t.symbolKey === target.tokenName)
    }
    if (token === undefined) {
      const msg = 'could not find token ' + target.tokenName + ' in reinvest. skipping this target'
      console.warn(msg)
      await telegram.send(msg)
      continue
    }
    const targetScript =
      target.getType() === ReinvestTargetType.Wallet ? (target.target as TargetWallet).script : undefined
    const [swap, estimatedResult] = await swapDFIForReinvest(inputAmount, token, targetScript, prevout, program)
    prevout = program.prevOutFromTx(swap)
    finalTx = swap
    if (targetScript !== undefined) {
      //swap to target was  already final step: add to log
      sentTokens
        .get((target.target as TargetWallet).address)!
        .push(usedDFI.toFixed(2) + '@DFI' + swappedSymbol + estimatedResult.toFixed(4) + '@' + target.tokenName)
    } else {
      toDeposit.push({
        tokenId: +token.id,
        inputAmount: inputAmount,
        estimatedResult: estimatedResult,
        usedDFI: usedDFI,
        target: target,
      })
    }
  }

  //handle LM targets: first swap parts, later add to LM
  for (const target of lpTargets) {
    let inputAmount = amountToUse.times(target.percent! / 100)
    const usedDFI = inputAmount
    //have to swap and wait
    let pool = allPools.find((p) => p.symbol === target.tokenName)
    if (pool === undefined) {
      const msg = 'could not find pool ' + target.tokenName + ' in reinvest. skipping this target'
      console.warn(msg)
      await telegram.send(msg)
      continue
    }
    console.log('swaping ' + inputAmount + ' DFI to ' + pool.tokenA.symbol + ' and ' + pool.tokenB.symbol)
    let estimatedA = inputAmount.div(2)
    if (+pool.tokenA.id != 0) {
      const [swap, estimatedResult] = await swapDFIForReinvest(estimatedA, pool.tokenA, undefined, prevout, program)
      prevout = program.prevOutFromTx(swap)
      finalTx = swap
      estimatedA = estimatedResult
    }
    let estimatedB = inputAmount.div(2)
    if (+pool.tokenB.id != 0) {
      const [swap, estimatedResult] = await swapDFIForReinvest(estimatedB, pool.tokenB, undefined, prevout, program)
      prevout = program.prevOutFromTx(swap)
      finalTx = swap
      estimatedB = estimatedResult
    }
    toAddtoLM.push({
      pool: pool,
      estimatedResultA: estimatedA,
      estimatedResultB: estimatedB,
      usedDFI: usedDFI,
      target: target,
    })
  }
  if (finalTx != undefined) {
    console.log('sent swaps, waiting for them to get confirmed before continuing')
    await program.updateToState(ProgramState.WaitingForTransaction, ReinvestTransaction.Swap, finalTx.txId)
    if (!(await program.waitForTx(finalTx.txId))) {
      await telegram.send('ERROR: swapping reinvestment failed')
      console.error('swapping reinvestment failed')
      //throw error?
      return { addressChanged: true, didReinvest: false, donatedAmount: new BigNumber(0) }
    }
  }
  //swaps done, now add liquidity and deposit
  //need to keep track of wo
  const availableBalances: Map<string, BigNumber> = new Map()
  const reduceAvailableBalance = (token: string, amountOut: BigNumber) => {
    availableBalances.set(token, availableBalances.get(token)?.minus(amountOut) ?? new BigNumber(0))
  }
  const availableBalance = (token: string): BigNumber => {
    return availableBalances.get(token) ?? new BigNumber(0)
  }

  balances = await program.getTokenBalances()
  balances.forEach((value, token) => availableBalances.set(token, new BigNumber(value.amount)))

  if (toAddtoLM.length > 0) {
    //add all liquidities
    allPools = await program.getPools()
    for (const t of toAddtoLM) {
      const pool = allPools.find((p) => p.id === t.pool.id)
      if (pool === undefined) {
        console.error('pool not found after swap. whats happening?!')
        continue
      }
      //check real used assets (might have changed due to swap)
      let usedA = BigNumber.min(t.estimatedResultA, availableBalance(pool.tokenA.symbol))
      let usedB = BigNumber.min(
        t.estimatedResultB,
        usedA.times(pool!.priceRatio.ba),
        availableBalance(pool.tokenB.symbol),
      )
      if (usedB.lt(usedA.times(pool.priceRatio.ba))) {
        //not enough b
        usedA = usedB.times(pool.priceRatio.ab)
      }

      console.log(
        'adding ' +
          usedA.toFixed(4) +
          '@' +
          pool.tokenA.symbol +
          ' with ' +
          usedB.toFixed(4) +
          '@' +
          pool.tokenB.symbol +
          ' to pool with target ' +
          (t.target.target as TargetWallet).address,
      )
      if (usedA.lte(0) || usedB.lte(0)) {
        console.warn('sub zero used assets in addLPToken, ignoring')
        continue
      }
      //keep track of already used assets. since we do all tx in one block, we need to keep track and ensure ourselfs
      reduceAvailableBalance(pool.tokenA.symbol, usedA)
      reduceAvailableBalance(pool.tokenB.symbol, usedB)

      //adding liquidity and sending the tokens directly to the targetScript
      const tx = await program.addLiquidity(
        [
          { token: +pool.tokenA.id, amount: usedA },
          { token: +pool.tokenB.id, amount: usedB },
        ],
        (t.target.target as TargetWallet).script,
        prevout,
      )
      prevout = program.prevOutFromTx(tx)
      finalTx = tx

      //just for logs
      const estimatedLP = usedA.times(pool.totalLiquidity.token).div(pool.tokenA.reserve)
      sentTokens
        .get((t.target.target as TargetWallet).address)!
        .push(t.usedDFI.toFixed(2) + '@DFI' + swappedSymbol + estimatedLP.toFixed(4) + '@' + t.target.tokenName)
    }
  }

  for (const t of toDeposit) {
    if (t.target.getType() !== ReinvestTargetType.Vault) {
      console.warn('in reinvest toDeposit, but targetType is not vault, ignoring')
      continue
    }
    if (t.tokenId !== 0) {
      t.inputAmount = BigNumber.min(t.estimatedResult, availableBalance(t.target.tokenName))
      console.log('got ' + t.inputAmount.toFixed(4) + ' ' + t.target.tokenName + ' to use after swap')
      if (t.inputAmount.lte(0)) {
        console.warn('got subzero asset to deposit, ignoring')
        continue
      }
      reduceAvailableBalance(t.target.tokenName, t.inputAmount)
    }
    const targetVault = (t.target.target as TargetVault).vaultId
    //deposit
    console.log('depositing ' + t.inputAmount + ' ' + t.target.tokenName + ' to vault ' + targetVault)
    const tx = await program.depositToVault(t.tokenId, t.inputAmount, targetVault, prevout)
    prevout = program.prevOutFromTx(tx)
    finalTx = tx

    depositTokens
      .get(targetVault)
      ?.push(
        (t.target.tokenName !== 'DFI' ? t.usedDFI.toFixed(2) + '@DFI' + swappedSymbol : '') +
          t.inputAmount.toFixed(4) +
          '@' +
          t.target.tokenName,
      )
  }

  await program.updateToState(ProgramState.WaitingForTransaction, ReinvestTransaction.DepositOrLM, finalTx!.txId)
  if (!(await program.waitForTx(finalTx!.txId))) {
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

    sentTokens.forEach((value, key) => {
      msg +=
        (key !== program.getAddress() ? 'sent to ' + simplifyAddress(key) : 'into wallet') +
        ':\n  ' +
        value.reduce((a, b) => a + '\n  ' + b) +
        '\n'
    })

    depositTokens.forEach((value, key) => {
      msg +=
        'deposited to ' +
        (key !== program.getVaultId() ? simplifyAddress(key) : 'own vault') +
        ':\n  ' +
        value.reduce((a, b) => a + '\n  ' + b) +
        '\n'
    })

    await telegram.send(msg)
    console.log('done ')
    if (settings.autoDonationPercentOfReinvest > 0 && donatedAmount.lte(0)) {
      console.log('sending manual donation suggestion')
      await telegram.send(
        'you activated auto donation, but the reinvested amount was too big to be a reinvest. ' +
          'We assume that this was a transfer of funds, so we skipped auto-donation. ' +
          'Feel free to manually donate anyway.',
      )
    }
  }
  return { addressChanged: true, didReinvest: true, donatedAmount: donatedAmount }
}
