import { config, Lambda } from 'aws-sdk'
import { AvailableBots, Bot } from '../utils/available-bot'
import { functionNameWithPostfix, multiBotDescriptionFor } from '../utils/helpers'
import { Store } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { Command, CommandInfo } from './command'

export class Execute extends Command {
  private payload: string
  private customSuccessMessage: string

  static maxi: CommandInfo = {
    description: 'executes your vault-maxi (Lambda function name: ' + functionNameWithPostfix(Bot.MAXI) + ')',
    usage: '/execute maxi',
  }

  static reinvest: CommandInfo = {
    description: 'executes your lm-reinvest (Lambda function name: ' + functionNameWithPostfix(Bot.REINVEST) + ')',
    usage: '/execute reinvest',
  }

  constructor(
    telegram: Telegram,
    store: Store,
    availableBots: AvailableBots,
    commandData: string[],
    payload: string = '',
    customSuccessMessage?: string,
  ) {
    super(telegram, store, availableBots, commandData)
    this.payload = payload
    this.customSuccessMessage = customSuccessMessage ?? 'execution done'
    config.update({
      maxRetries: 0,
      httpOptions: {
        timeout: 14 * 60 * 1000, // 14 minutes timeout
        connectTimeout: 5000,
      },
    })
  }

  static descriptionFor(bots: Bot[]): string | undefined {
    return multiBotDescriptionFor(bots, Execute.maxi, Execute.reinvest)
  }

  availableFor(): Bot[] {
    return [Bot.MAXI, Bot.REINVEST]
  }

  doExecution(): Promise<unknown> {
    let lambda = new Lambda()

    let params = {
      FunctionName: functionNameWithPostfix(Bot.MAXI),
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: this.payload,
    }

    console.log('invoking lambda with params ' + JSON.stringify(params))

    return lambda
      .invoke(params)
      .promise()
      .then((value) => {
        // read payload to get status code of executed lambda
        if (value.Payload !== undefined) {
          console.log('returned payload: ' + value.Payload)
          let lambdaResponse = JSON.parse(value.Payload as string)
          if (lambdaResponse.statusCode === 200) {
            this.telegram.send(this.customSuccessMessage)
          } else {
            this.telegram.send('Triggered execution returned with an error. Please check yourself!')
          }
        } else {
          this.telegram.send('Triggered execution returned with an error. Please check yourself!')
        }
      })
  }
}
