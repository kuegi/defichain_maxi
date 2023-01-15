import { LogLevel, Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { ProgramState } from './programs/common-program'
import { delay } from './utils/helpers'
import { WhaleClientTimeoutException } from '@defichain/whale-api-client'
import { StoreAWSBalancer } from './utils/store_aws_portbalancer'
import { BalancerProgram } from './programs/balancer-program'

class botEvent {
  checkSetup: boolean | undefined
}

const MIN_TIME_PER_ACTION_MS = 300 * 1000 //min 5 minutes for action.

export const VERSION = 'v0.1'

export async function main(event: botEvent, context: any): Promise<Object> {
  console.log('portfolioBalancer ' + VERSION)
  let blockHeight = 0
  let ocean = process.env.VAULTMAXI_OCEAN_URL
  let errorCooldown = 60000
  while (context.getRemainingTimeInMillis() >= MIN_TIME_PER_ACTION_MS) {
    console.log('starting with ' + context.getRemainingTimeInMillis() + 'ms available')
    let store = new StoreAWSBalancer()
    let settings = await store.fetchSettings()

    const telegram = new Telegram(settings, '[Balancer ' + VERSION + ']')
    try {
      if (event) {
        console.log('received event ' + JSON.stringify(event))
      }
      while (settings.stateInformation.state != ProgramState.Idle) {
        console.log('not idle, waiting 30 sec')
        delay(30000)
        settings = await store.fetchSettings()
      }
      const program = new BalancerProgram(store, settings, new WalletSetup(settings, ocean))
      await program.init()
      blockHeight = await program.getBlockHeight()
      console.log('starting at block ' + blockHeight)
      if (event) {
        if (event.checkSetup) {
          let result = await program.doAndReportCheck(telegram)
          return { statusCode: result ? 200 : 500 }
        }
      }

      await program.checkAndDoRebalancing(telegram)

      console.log('script done ')
      return { statusCode: 200 }
    } catch (e) {
      console.error('Error in script')
      console.error(e)
      let message = 'There was an unexpected error in the script. please check the logs'
      if (e instanceof SyntaxError) {
        console.info("syntaxError: '" + e.name + "' message: " + e.message)
        if (e.message == 'Unexpected token < in JSON at position 0') {
          message = 'There was a error from the ocean api. will try again.'
        }
        //TODO: do we have to go to error state in this case? or just continue on current state next time?
      }
      if (e instanceof WhaleClientTimeoutException) {
        message = 'There was a timeout from the ocean api. will try again.'
        //TODO: do we have to go to error state in this case? or just continue on current state next time?
      }
      await telegram.send(message, LogLevel.ERROR)
      if (ocean != undefined) {
        console.info('falling back to default ocean')
        ocean = undefined
      }
      break //FIXME: no loops during development and debug
      await delay(errorCooldown) // cooldown and not to spam telegram
      errorCooldown += 60000 //increase cooldown. if error is serious -> less spam in telegram
    }
  }
  return { statusCode: 500 } //means we came out of error loop due to not enough time left
}
