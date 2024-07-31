import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { LogLevel, Telegram } from '../utils/telegram'
import { CommonProgram, ProgramState } from './common-program'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { IStore } from '../utils/store'
import { WalletSetup } from '../utils/wallet-setup'
import { OracleBotSettings } from '../utils/store_aws_oraclebot'
import { OP_CODES } from '@defichain/jellyfish-transaction'

export class OracleBotProgram extends CommonProgram {
  constructor(store: IStore, settings: OracleBotSettings, walletSetup: WalletSetup) {
    super(store, settings, walletSetup)
  }

  async readAndSendOracle(telegram: Telegram): Promise<boolean> {
    // get data from CMC API
    const response = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', {
      headers: {
        'X-CMC_PRO_API_KEY': (this.settings as OracleBotSettings).cmcAPIKey,
      },
    })
    const reply = await response.json()

    const btcData: { quote: any } = reply.data.find((d: any) => d.symbol == 'BTC')
    const usdPrice = btcData.quote['USD']['price']

    console.log('got btc price: ' + usdPrice)

    // put it into oracle data and send to ocean
    const tx = await this.sendOrCreateDefiTx(
      OP_CODES.OP_DEFI_TX_SET_ORACLE_DATA({
        oracleId: (this.settings as OracleBotSettings).oracleId,
        timestamp: BigNumber(Date.now() / 1000),
        tokens: [{ token: 'BTC', prices: [{ amount: BigNumber(usdPrice), currency: 'USD' }] }],
      }),
      undefined,
    )
    let result = await this.waitForTx(tx!.txId)
    if (result) {
      telegram.send('done oracle tx', LogLevel.INFO)
      return true
    } else {
      telegram.send('failed to do oracle', LogLevel.WARNING)
      return false
    }
  }
}
