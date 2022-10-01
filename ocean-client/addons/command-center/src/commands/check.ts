import { Command, CommandInfo } from './command'
import { Lambda } from 'aws-sdk'
import { multiBotDescriptionFor } from '../utils/helpers'
import { BotType, LM_REINVEST, VAULT_MAXI } from '../utils/available-bot'

export class Check extends Command {
  static maxi: CommandInfo = {
    description: 'executes check-setup on your vault-maxi (Lambda function name: ' + VAULT_MAXI + ')',
    usage: '/check maxi',
  }

  static reinvest: CommandInfo = {
    description: 'executes check-setup on your lm-reinvest (Lambda function name: ' + LM_REINVEST + ')',
    usage: '/check reinvest',
  }

  static descriptionFor(bots: BotType[]): string | undefined {
    return multiBotDescriptionFor(bots, Check.maxi, Check.reinvest)
  }

  availableFor(): BotType[] {
    return [BotType.MAXI, BotType.REINVEST]
  }

  async doExecution(): Promise<unknown> {
    if (!this.bot) return Promise.reject()
    let lambda = new Lambda()

    let params = {
      FunctionName: this.bot.name,
      InvocationType: 'Event',
      LogType: 'None',
      Payload: '{"checkSetup":true}',
    }

    console.log('invoking lambda with params ' + JSON.stringify(params))
    await this.telegram.send('trying to invoke ' + params.FunctionName)

    return lambda.invoke(params).promise()
  }
}
