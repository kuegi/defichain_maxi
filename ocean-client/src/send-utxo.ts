import { SendProgramm } from './programs/send-utxo-program'
import { StoreAWSSendUTXO } from './utils/store_aws_send-utxo'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
class maxiEvent {
  checkSetup: boolean | undefined
}
const MIN_TIME_PER_ACTION_MS = 300 * 1000 //min 5 minutes for action. probably only needs 1-2, but safety first?

export const VERSION = 'v1.0.0'

export async function main(event: maxiEvent, context: any): Promise<Object> {
  console.log('send ' + VERSION)
  let ocean = process.env.VAULTMAXI_OCEAN_URL

  while (context.getRemainingTimeInMillis() >= MIN_TIME_PER_ACTION_MS) {
    console.log('starting with ' + context.getRemainingTimeInMillis() + 'ms available')
    let store = new StoreAWSSendUTXO()
    let settings = await store.fetchSettings()

    if (event) {
      console.log('received event ' + JSON.stringify(event))
    }
    const logId = process.env.VAULTMAXI_LOGID ? ' ' + process.env.VAULTMAXI_LOGID : ''
    const telegram = new Telegram(settings, '[send-utxo' + settings.paramPostFix + ' ' + VERSION + logId + ']')

    try {
      const program = new SendProgramm(store, new WalletSetup(settings, ocean))
      await program.init()

      if (event) {
        if (event.checkSetup) {
          let result = await program.doChecks(telegram)
          return { statusCode: result ? 200 : 500 }
        }
      }
      await program.doSend(telegram)
      return { statusCode: 200 }
    } catch {
      telegram.send('Unexpected error')
      return { statusCode: 500 }
    }
  }
  return { statusCode: 500 }
}
