import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { LogLevel, Telegram } from '../utils/telegram'
import { CommonProgram, ProgramState } from './common-program'
import { BigNumber, oracle } from '@defichain/jellyfish-api-core'
import { IStore } from '../utils/store'
import { WalletSetup } from '../utils/wallet-setup'
import { StoredTestnetBotSettings } from '../utils/store_aws_testnetbot'
import { PoolId, TokenAmount, TokenBalanceUInt32 } from '@defichain/jellyfish-transaction/dist'
import { StoredBalancerSettings } from '../utils/store_aws_portbalancer'
import {
  checkReinvestTargets,
  getReinvestMessage,
  initReinvestTargets,
  ReinvestTarget,
  ReinvestTargetTokenType,
  ReinvestTargetType,
  TargetWallet,
} from '../utils/reinvestor'
import { AddressToken } from '@defichain/whale-api-client/dist/api/address'
import { ActivePrice } from '@defichain/whale-api-client/dist/api/prices'
import { TokenData } from '@defichain/whale-api-client/dist/api/tokens'

export class BalancerProgram extends CommonProgram {
  private portfolioTargets: ReinvestTarget[] = []

  constructor(store: IStore, settings: StoredBalancerSettings, walletSetup: WalletSetup) {
    super(store, settings, walletSetup)
  }

  private getSettings(): StoredBalancerSettings {
    return this.settings as StoredBalancerSettings
  }

  async init(): Promise<boolean> {
    let result = await super.init()

    let pattern = this.getSettings().portfolioPattern
    this.portfolioTargets = await initReinvestTargets(pattern, this)

    return result
  }

  async doMaxiChecks(telegram: Telegram, pool: PoolPairData | undefined): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false
    }

    const utxoBalance = await this.getUTXOBalance()
    if (utxoBalance.lte(1e-4)) {
      //1 tx is roughly 2e-6 fee, one action mainly 3 tx -> 6e-6 fee. we want at least 10 actions safety -> below 1e-4 we warn
      const message =
        'your UTXO balance is running low in ' +
        this.settings.address +
        ', only ' +
        utxoBalance.toFixed(5) +
        ' DFI left. Please replenish to prevent any errors'
      await telegram.send(message, LogLevel.ERROR)
    }

    //check reinvest pattern
    if (!(await checkReinvestTargets(this.portfolioTargets, telegram))) {
      this.portfolioTargets = []
    } else {
      //only own address targets for now
      let error = false
      let targets: Set<string> = new Set()
      for (const t of this.portfolioTargets) {
        if (t.getType() !== ReinvestTargetType.Wallet) {
          await telegram.send('only wallet targets possible right now', LogLevel.ERROR)
          error = true
        } else if ((t.target as TargetWallet).address != this.getAddress()) {
          await telegram.send('only own address targets possible right now', LogLevel.ERROR)
          error = true
        }
        if (targets.has(t.tokenName)) {
          await telegram.send('duplicate target for token ' + t.tokenName, LogLevel.ERROR)
          error = true
        }
      }
      if (error) {
        this.portfolioTargets = []
      }
    }

    return true
  }

  async doAndReportCheck(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false //report already send inside
    }

    let walletAddress = this.getAddress()
    const portfolioMessage =
      'portfolio Targets:\n  ' +
      this.portfolioTargets
        .map((target) => target.percent!.toFixed(1) + '%  in ' + target.tokenName)
        .reduce((a, b) => a + '\n  ' + b)
    let message =
      'Setup-Check result:\n' +
      (walletAddress ? 'monitoring address ' + walletAddress : 'no valid address') +
      '\n' +
      (this.canSign()
        ? 'got valid key: will send tx automatically'
        : 'no valid key, will provide tx for manual signing') +
      '\n' +
      portfolioMessage +
      '\n will rebalance once one position is more than ' +
      this.getSettings().rebalanceThreshold +
      '% above target'

    message += '\nusing ocean at: ' + this.walletSetup.url

    console.log(message)
    console.log('using telegram for log: ' + telegram.logToken + ' chatId: ' + telegram.logChatId)
    console.log('using telegram for notification: ' + telegram.token + ' chatId: ' + telegram.chatId)
    await telegram.send(message, LogLevel.ERROR)
    await telegram.send('log channel active', LogLevel.VERBOSE)

    return true
  }

  async getAndCacheOracleValue(oracles: Map<string, ActivePrice>, token: string): Promise<BigNumber> {
    if (!oracles.has(token)) {
      oracles.set(token, await this.getFixedIntervalPrice(token))
    }
    return new BigNumber(token === 'DUSD' ? 1 : oracles.get(token)?.active?.amount ?? 0)
  }

  async checkAndDoRebalancing(telegram: Telegram) {
    if (this.portfolioTargets.length == 0) {
      await telegram.send('no portfolio targets defined. please provide valid targets', LogLevel.WARNING)
      return
    }

    const balances = await this.getTokenBalances()
    const pools = await this.getPools()
    // check current portfolio based on pattern
    let tokenToTarget: Map<string, PortfolioEntry> = new Map()
    this.portfolioTargets.forEach((target) => {
      const entry = new PortfolioEntry(target, balances.get(target.tokenName))
      tokenToTarget.set(target.tokenName, entry)
    })

    const oracles: Map<string, ActivePrice> = new Map()
    let totalValue = new BigNumber(0)
    for (const entry of tokenToTarget.values()) {
      if (entry.target.tokenType === ReinvestTargetTokenType.LPToken) {
        const pool = pools.find((pool) => {
          return pool.symbol == entry.target.tokenName
        })
        if (!pool) {
          await telegram.send(
            'could not find pool for ' + entry.target.tokenName + ". please fix. won't continue until fixed.",
            LogLevel.ERROR,
          )
          return
        }
        const oracleA = await this.getAndCacheOracleValue(oracles, pool!.tokenA.symbol)
        const oracleB = await this.getAndCacheOracleValue(oracles, pool!.tokenB.symbol)

        const myLPTokens = new BigNumber(entry.currentAmount?.amount ?? 0)
        const myA = myLPTokens.multipliedBy(pool.tokenA.reserve).div(pool.totalLiquidity.token)
        const myB = myLPTokens.multipliedBy(pool.tokenB.reserve).div(pool.totalLiquidity.token)

        entry.currentValue = myA.times(oracleA).plus(myB.times(oracleB))
        entry.resultingTokens.push({ token: pool!.tokenA, amount: myA, oracleValue: oracleA })
        entry.resultingTokens.push({ token: pool!.tokenB, amount: myB, oracleValue: oracleB })
        totalValue = totalValue.plus(entry.currentValue)
      } else {
        let token: TokenInfo
        if (entry.currentAmount) {
          token = entry.currentAmount
        } else {
          token = await this.getToken(entry.target.tokenName)
        }
        const oracleValue = await this.getAndCacheOracleValue(oracles, entry.target.tokenName)
        const currentAmount = new BigNumber(entry.currentAmount?.amount ?? 0)
        entry.currentValue = currentAmount.multipliedBy(oracleValue)
        entry.resultingTokens.push({ token: token, amount: currentAmount, oracleValue: oracleValue })
        totalValue = totalValue.plus(entry.currentValue)
      }
    }

    // decide which to reduce -> $ amount to distribute
    // have sorted list where to redistribute it to (needed tokens vs resulting tokens)
    const entriesAboveThreshold: PortfolioEntry[] = []
    const sortedEntries: PortfolioEntry[] = []
    let usdToDistribute = new BigNumber(0)
    const tokenMatch: Map<string, TokenMatch> = new Map()
    const LMToRemove: { poolId: number; poolSymbol: string; amount: BigNumber }[] = []
    const LPToAdd: {
      assetA: { tokenId: number; tokenSymbol: string; amount: BigNumber }
      assetB: { tokenId: number; tokenSymbol: string; amount: BigNumber }
    }[] = []

    for (const entry of tokenToTarget.values()) {
      entry.currentPercent = entry.currentValue.div(totalValue).times(100)
      console.log(JSON.stringify(entry) + ' vs total: ' + totalValue.toFixed(2))
      entry.usdDelta = entry.currentValue.minus(totalValue.times(entry.target.percent ?? 0).div(100))
      sortedEntries.push(entry)
      //TODO: target+threshold or target*(1+threshold)? so threshold it percentage-points or relative to position?
      if (entry.currentPercent.gt((entry.target.percent ?? 0) + this.getSettings().rebalanceThreshold)) {
        // overexposed -> reduce exposure
        entriesAboveThreshold.push(entry)
        usdToDistribute = usdToDistribute.plus(
          //TODO: decide: reduce to target, or have a "rebalanceTo" level. f.e. "rebalances above 10% overexposure, reduce to 2% overexposure"?
          totalValue.times(entry.currentPercent.minus(entry.target.percent ?? 0).div(100)),
        )
        const ratioToDistribute = usdToDistribute.div(entry.currentValue)
        if (entry.target.tokenType === ReinvestTargetTokenType.LPToken) {
          const pool = pools.find((p) => p.symbol === entry.target.tokenName)
          if (pool) {
            LMToRemove.push({
              poolId: +pool.id,
              poolSymbol: pool.symbol,
              amount: ratioToDistribute.multipliedBy(entry.currentAmount?.amount ?? 0),
            })
          }
        }
        entry.resultingTokens.forEach((t) => {
          if (!tokenMatch.has(t.token.symbol)) {
            tokenMatch.set(t.token.symbol, {
              id: +t.token.id,
              toDistribute: new BigNumber(0),
              forIncrease: new BigNumber(0),
            })
          }
          tokenMatch.get(t.token.symbol)!.toDistribute = tokenMatch
            .get(t.token.symbol)!
            .toDistribute.plus(t.amount.times(ratioToDistribute))
        })
        //TODO: add distribution of LM Tokens to list of txs (removeLiquidity)
      }
    }
    sortedEntries.sort((a, b) => a.usdDelta.minus(b.usdDelta).toNumber())
    let msg = 'your current portfolio disribution:\n'
    sortedEntries.forEach((entry) => {
      msg += `${entry.target.tokenName}: $${entry.currentValue.toFixed(2)} = ${entry.currentPercent.toFixed(1)}% (${
        entry.target.percent
      }%) delta $${entry.usdDelta.toFixed(2)}\n`
    })
    console.log('target entries: ' + JSON.stringify(sortedEntries))
    await telegram.send(msg, LogLevel.VERBOSE)
    if (entriesAboveThreshold.length == 0) {
      return //nothing to do
    }

    const entriesToIncrease: PortfolioEntry[] = []
    let sumInTargets = new BigNumber(0)
    for (const entry of sortedEntries) {
      if (entry.usdDelta.gte(0)) {
        break //don't distribute where its already above target
      }
      sumInTargets = sumInTargets.minus(entry.usdDelta)
      entriesToIncrease.push(entry)

      if (sumInTargets.gte(usdToDistribute)) {
        //TODO: decide if we
        // * fill lowest targets fully till usd is gone -> break here
        // or fill all targets below 0 equally -> no break here
        break
      }
    }

    //TODO: decide: fillfactor like this (all "holes" get filled by X%) or fill to equal amount (every target is filled equally "close" to the target)
    const fillFactor = BigNumber.min(sumInTargets, usdToDistribute).div(usdToDistribute)
    const gapPerEntry = sumInTargets.minus(usdToDistribute).div(entriesToIncrease.length)
    // fill list of token : tokenToDistribute , wantedTokenForIncrease
    entriesToIncrease.forEach((entry) => {
      //filling "neededDUSD * fillFactor". so will fill factor <filledDUSD>/<currentDUSDValue> of current tokenAmount
      const dollarToAdd = fillFactor.times(entry.usdDelta.negated())
      //if filling with fixed gap:
      //const dollarToAdd= entry.usdDelta.negated().minus(gapPerEntry)

      if (dollarToAdd.lt(1)) {
        //ignore micro txs
        console.log(`ignoring increase of ${dollarToAdd.toFixed(2)} in ${entry.target.tokenName}`)
        return
      }
      const dollarAddPerToken = dollarToAdd.div(entry.resultingTokens.length)

      entry.resultingTokens.forEach((t) => {
        if (!tokenMatch.has(t.token.symbol)) {
          tokenMatch.set(t.token.symbol, {
            id: +t.token.id,
            toDistribute: new BigNumber(0),
            forIncrease: new BigNumber(0),
          })
        }

        tokenMatch.get(t.token.symbol)!.forIncrease = tokenMatch
          .get(t.token.symbol)!
          .forIncrease.plus(dollarAddPerToken.div(t.oracleValue))
      })
      if (entry.target.tokenType === ReinvestTargetTokenType.LPToken) {
        const a = entry.resultingTokens[0]
        const b = entry.resultingTokens[1]
        LPToAdd.push({
          assetA: { tokenId: +a.token.id, tokenSymbol: a.token.symbol, amount: dollarAddPerToken.div(a.oracleValue) },
          assetB: { tokenId: +b.token.id, tokenSymbol: b.token.symbol, amount: dollarAddPerToken.div(b.oracleValue) },
        })
      }
    })
    console.log('target entries after processing: ' + JSON.stringify(sortedEntries))

    console.log('entriesToIncrease: ' + JSON.stringify(entriesToIncrease))
    //now tokenMatch is a list of amounts how many token we need and how many we have.
    // split to sourceTokens ( where more tokens exist than we need) and targetTokens (where less exist than we need)
    // match sourceTokens with targetTokens based on USD value
    // !! Challenge: oracle prices might not reflect real prices we get on dex.

    //calcSwaps
    const wantedSwaps: {
      sourceId: number
      sourceSymbol: string
      targetId: number
      targetSymbol: string
      amount: BigNumber
    }[] = []
    const sources = [...tokenMatch.values()]
      .filter((m) => m.toDistribute.gt(m.forIncrease))
      .map((m) => {
        return { token: m.id, amount: m.toDistribute.minus(m.forIncrease) }
      })
      .sort((a, b) => a.amount.comparedTo(b.amount))
    const targets = [...tokenMatch.values()]
      .filter((m) => m.toDistribute.lt(m.forIncrease))
      .map((m) => {
        return { token: m.id, amount: m.forIncrease.minus(m.toDistribute) }
      })
      .sort((a, b) => a.amount.comparedTo(b.amount))

    console.log('all tokenMatch ' + JSON.stringify([...tokenMatch.values()]))
    console.log('sources ' + JSON.stringify(sources))
    console.log('targets ' + JSON.stringify(targets))

    //TODO: run throu source and targets and fill wanted swaps
    let currentTarget = 0
    let remainingTargetAmount = targets.length > 0 ? targets[0].amount : new BigNumber(0)
    for (const source of sources) {
      if (currentTarget >= targets.length) {
        break //TODO: what to do with remaining sources?
      }
      let target = targets[currentTarget]
      let remainingSource = source.amount

      while (remainingSource.gt(0)) {
        const path = await this.client.poolpairs.getBestPath('' + source.token, '' + target.token)
        const usedAmount = BigNumber.min(remainingSource, remainingTargetAmount.div(path.estimatedReturnLessDexFees))
        if (usedAmount.lte(1e-8)) {
          console.warn(
            'got 0 amount to swap. whats happening? ' +
              remainingSource.toFixed(8) +
              ' vs ' +
              remainingTargetAmount.toFixed(8) +
              ' with path ' +
              JSON.stringify(path),
          )
          break
        }
        wantedSwaps.push({
          sourceId: source.token,
          sourceSymbol: path.fromToken.symbol,
          targetId: target.token,
          targetSymbol: path.toToken.symbol,
          amount: usedAmount,
        })
        remainingSource = remainingSource.minus(usedAmount)
        remainingTargetAmount = remainingTargetAmount.minus(usedAmount.times(path.estimatedReturnLessDexFees))
        if (remainingTargetAmount.lte(1e-8)) {
          currentTarget++
          if (currentTarget < targets.length) {
            remainingTargetAmount = targets[currentTarget].amount
            target = targets[currentTarget]
          } else {
            break //no more targets
          }
        }
      }
    }

    console.log('swaps ' + JSON.stringify(wantedSwaps))
    //log recommended actions for now

    const introMsg = 'Your portfolio is imbalanced, here are some recommended steps to rebalance it:'
    await telegram.send(introMsg, LogLevel.INFO)

    console.log('got ' + LMToRemove.length + ' LP to remove')
    if (LMToRemove.length > 0) {
      let removeLMtokens = 'remove the following liquidity:\n'
      LMToRemove.forEach((balance) => {
        removeLMtokens += `${balance.amount.toFixed(8)}@${balance.poolSymbol}\n`
      })
      await telegram.send(removeLMtokens, LogLevel.INFO)
    }
    console.log('got ' + wantedSwaps.length + ' swaps')
    if (wantedSwaps.length > 0) {
      //log swaps

      let msg = 'do the following swaps:\n'
      wantedSwaps.forEach((swap) => {
        msg += `${swap.amount.toFixed(8)}@${swap.sourceSymbol} \u{27a1} ${swap.targetSymbol}\n`
      })
      await telegram.send(msg, LogLevel.INFO)
    }
    console.log('got ' + LPToAdd.length + ' LP to add')
    if (LPToAdd.length > 0) {
      let msg = 'add the following liquidity:\n'
      LPToAdd.forEach((balance) => {
        msg += `${balance.assetA.amount.toFixed(8)}@${balance.assetA.tokenSymbol} with ${balance.assetB.amount.toFixed(
          8,
        )}@${balance.assetB.tokenSymbol}\n`
      })
      await telegram.send(msg, LogLevel.INFO)
    }
  }
}

interface TokenMatch {
  id: number
  toDistribute: BigNumber
  forIncrease: BigNumber
}

interface TokenInfo {
  id: string
  symbol: string
}

class PortfolioEntry {
  public target: ReinvestTarget
  public currentAmount: AddressToken | undefined
  public currentPercent: BigNumber = new BigNumber(0)
  public usdDelta: BigNumber = new BigNumber(0)
  public currentValue: BigNumber = new BigNumber(0)
  public resultingTokens: { token: TokenInfo; amount: BigNumber; oracleValue: BigNumber }[] = []

  constructor(target: ReinvestTarget, tokenAmount: AddressToken | undefined) {
    this.target = target
    this.currentAmount = tokenAmount
  }
}
