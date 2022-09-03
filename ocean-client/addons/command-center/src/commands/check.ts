import { Command, CommandInfo } from './command'
import { Lambda } from 'aws-sdk'
import { functionNameWithPostfix, multiBotDescriptionFor } from '../utils/helpers'
import { Bot } from '../utils/available-bot'

export class Check extends Command {
  static maxi: CommandInfo = {
    description:
      'executes check-setup on your vault-maxi (Lambda function name: ' + functionNameWithPostfix(Bot.MAXI) + ')',
    usage: '/check maxi',
  }

  static reinvest: CommandInfo = {
    description:
      'executes check-setup on your lm-reinvest (Lambda function name: ' + functionNameWithPostfix(Bot.REINVEST) + ')',
    usage: '/check reinvest',
  }

  static descriptionFor(bots: Bot[]): string | undefined {
    return multiBotDescriptionFor(bots, Check.maxi, Check.reinvest)
  }

  availableFor(): Bot[] {
    return [Bot.MAXI, Bot.REINVEST]
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
