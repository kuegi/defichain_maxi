import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { Telegram } from '../utils/telegram'
import { CommonProgram, ProgramState } from './common-program'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { IStore } from '../utils/store'
import { WalletSetup } from '../utils/wallet-setup'
import { StoredTestnetBotSettings } from '../utils/store_aws_testnetbot'
import { PoolId } from '@defichain/jellyfish-transaction/dist'
import { LogLevel } from './vault-maxi-program'

export class TestnetBotProgram extends CommonProgram {
  constructor(store: IStore, settings: StoredTestnetBotSettings, walletSetup: WalletSetup) {
    super(store, settings, walletSetup)
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

    return true
  }

  async doAndReportCheck(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false //report already send inside
    }

    let walletAddress = this.getAddress()

    let message =
      'Setup-Check result:\n' +
      (walletAddress ? 'monitoring address ' + walletAddress : 'no valid address') +
      '\n' +
      (this.canSign()
        ? 'got valid key: will send tx automatically'
        : 'no valid key, will provide tx for manual signing') +
      '\n'

    message += '\nusing ocean at: ' + this.walletSetup.url

    console.log(message)
    console.log('using telegram for log: ' + telegram.logToken + ' chatId: ' + telegram.logChatId)
    console.log('using telegram for notification: ' + telegram.token + ' chatId: ' + telegram.chatId)
    await telegram.send(message, LogLevel.ERROR)
    await telegram.send('log channel active', LogLevel.VERBOSE)

    return true
  }

  private combineFees(fees: (string | undefined)[]): BigNumber {
    return new BigNumber(fees.reduce((prev, fee) => prev * (1 - +(fee ?? '0')), 1))
  }

  async checkAndDoArbitrage(telegram: Telegram): Promise<boolean> {
    const poolData = await this.getPools()
    const dusdPool = poolData.find((pool) => pool.symbol === 'DUSD-DFI')
    const usdtPool = poolData.find((pool) => pool.symbol === 'DFI-USDT')
    const dusdusdtPool = poolData.find((pool) => pool.symbol === 'DUSD-USDT')

    if (!dusdPool?.priceRatio.ab || !usdtPool?.priceRatio.ab || !dusdusdtPool?.priceRatio.ba) {
      console.error("couldn't get stable pool data")
      return false
    }
    const ratio = new BigNumber(dusdPool.priceRatio.ab).times(dusdusdtPool.priceRatio.ba).times(usdtPool.priceRatio.ab)
    const feeIn = this.combineFees([
      dusdPool.tokenB.fee?.inPct,
      dusdPool.tokenA.fee?.outPct,
      dusdusdtPool.tokenA.fee?.inPct,
      dusdusdtPool.tokenB.fee?.outPct,
      usdtPool.tokenB.fee?.inPct,
      usdtPool.tokenA.fee?.outPct,
      usdtPool.commission,
      dusdusdtPool.commission,
      dusdPool.commission,
    ])
    const feeOut = this.combineFees([
      dusdPool.tokenA.fee?.inPct,
      dusdPool.tokenB.fee?.outPct,
      dusdusdtPool.tokenB.fee?.inPct,
      dusdusdtPool.tokenA.fee?.outPct,
      usdtPool.tokenA.fee?.inPct,
      usdtPool.tokenB.fee?.outPct,
      usdtPool.commission,
      dusdusdtPool.commission,
      dusdPool.commission,
    ])

    const ratioIn = ratio.times(feeIn)
    const ratioOut = feeOut.div(ratio)
    console.log('got ratio in: ' + ratioIn.toFixed(2) + ' out: ' + ratioOut.toFixed(2))

    let path: PoolId[] | undefined
    let loops = 1
    if (ratioIn.gt(1.05)) {
      loops = ratioIn.toNumber()
      path = [{ id: +usdtPool.id }, { id: +dusdPool.id }, { id: +dusdusdtPool.id }]
    }
    if (ratioOut.gt(1.05)) {
      loops = ratioOut.toNumber()
      path = [{ id: +dusdusdtPool.id }, { id: +dusdPool.id }, { id: +usdtPool.id }]
    }
    if (path != undefined) {
      console.log('trying arbitrage with ' + Math.floor(loops) + ' loops')
      let prevout = undefined
      let swap = undefined
      for (let i = 0; i < Math.floor(loops); i++) {
        swap = await this.compositeswap(new BigNumber(1000), 5, 5, path, new BigNumber(1), undefined, prevout)
        prevout = this.prevOutFromTx(swap)
      }
      let result = await this.waitForTx(swap!.txId)
      if (result) {
        telegram.send('done arbitrage', LogLevel.INFO)
        return true
      } else {
        telegram.send('failed to do arbitrage', LogLevel.WARNING)
        return false
      }
    } else {
      return false
    }
  }
}
