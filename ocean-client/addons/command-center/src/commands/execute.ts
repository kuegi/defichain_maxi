import { config, Lambda } from 'aws-sdk'
import { AvailableBots, BotType, LM_REINVEST, VAULT_MAXI } from '../utils/available-bot'
import { multiBotDescriptionFor } from '../utils/helpers'
import { Store } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { Command, CommandInfo } from './command'

export class Execute extends Command {
  private payload: string
  private customSuccessMessage: string

  static maxi: CommandInfo = {
    description: 'executes your vault-maxi (Lambda function name: ' + VAULT_MAXI + ')',
    usage: '/execute maxi',
  }

  static reinvest: CommandInfo = {
    description: 'executes your lm-reinvest (Lambda function name: ' + LM_REINVEST + ')',
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

  static descriptionFor(bots: BotType[]): string | undefined {
    return multiBotDescriptionFor(bots, Execute.maxi, Execute.reinvest)
  }

  availableFor(): BotType[] {
    return [BotType.MAXI, BotType.REINVEST]
  }

  async doExecution(): Promise<unknown> {
    if (!this.bot) return Promise.reject()
    let lambda = new Lambda()

    let params = {
      FunctionName: this.bot.name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: this.payload,
    }

    console.log('invoking lambda with params ' + JSON.stringify(params))
    await this.telegram.send('trying to invoke ' + params.FunctionName)

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
