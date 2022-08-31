import { Command } from './command'
import { Lambda } from 'aws-sdk'
import { Telegram } from '../utils/telegram'
import { functionNameWithPostfix } from '../utils/helpers'
import { Bot } from '../utils/available-bot'

export class Check extends Command {
  static descriptionMaxi =
    'executes check-setup on your vault-maxi (Lambda function name: ' + functionNameWithPostfix(Bot.MAXI) + ')'
  static descriptionReinvest =
    'executes check-setup on your lm-reinvest (Lambda function name: ' + functionNameWithPostfix(Bot.REINVEST) + ')'

  static usageMaxi = '/check maxi'
  static usageReinvest = '/check reinvest'

  constructor(telegram: Telegram) {
    super(telegram)
  }

  static descriptionFor(bots: Bot[]): string | undefined {
    if (bots.includes(Bot.MAXI) && bots.includes(Bot.REINVEST))
      return this.descriptionMaxi + '\n' + this.usageMaxi + '\n' + this.descriptionReinvest + '\n' + this.usageReinvest
    if (bots.includes(Bot.MAXI)) return this.descriptionMaxi
    if (bots.includes(Bot.REINVEST)) return this.descriptionReinvest
    return undefined
  }

  doExecution(): Promise<unknown> {
    let lambda = new Lambda()

    let params = {
      FunctionName: functionNameWithPostfix(Bot.MAXI),
      InvocationType: 'Event',
      LogType: 'None',
      Payload: '{"checkSetup":true}',
    }

    return lambda.invoke(params).promise()
  }
}
