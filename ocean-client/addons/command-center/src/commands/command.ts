import { AvailableBots, Bot } from '../utils/available-bot'
import { Store } from '../utils/store'
import { Telegram } from '../utils/telegram'

export interface CommandInfo {
  description: string
  usage: string
}

export enum Commands {
  Help = '/help',
  Bots = '/bots',
  Check = '/check',
  Skip = '/skip',
  Resume = '/resume',
  Execute = '/execute',
  RemoveExposure = '/removeExposure',
  SetRange = '/setRange',
  SetReinvest = '/setReinvest',
  SetAutoDonation = '/setAutoDonation',
  SetStableArbSize = '/setStableArbSize',
}

export abstract class Command {
  protected telegram: Telegram
  protected store: Store
  protected availableBots: AvailableBots
  protected bot: Bot | undefined = undefined
  protected commandData: string[] = []

  constructor(telegram: Telegram, store: Store, availableBots: AvailableBots, commandData: string[]) {
    this.telegram = telegram
    this.store = store
    this.availableBots = availableBots
    const bots = availableBots.getBots()
    if (bots.length === 1) this.bot = bots[0]
    this.commandData = commandData
  }

  protected isUndecided(): boolean {
    return this.bot === undefined
  }

  protected isUnavailable(): boolean {
    if (!this.bot) return true
    return !this.availableFor().includes(this.bot)
  }

  protected isBotBusy(): boolean {
    return !this.availableBots.getBotDataFor(this.bot)?.isIdle
  }

  protected parseBot(): void {
    if (!this.isUndecided() || this.commandData.length < 2) return
    console.log('parseBot', this.commandData)
    switch (this.commandData[1]) {
      case 'maxi':
      case 'vault-maxi':
        this.bot = Bot.MAXI
        break
      case 'lm':
      case 'reinvest':
      case 'lm-reinvest':
        this.bot = Bot.REINVEST
        break
    }

    if (this.bot) {
      this.commandData.splice(1, 1)
      console.log('parseBot', this.commandData)
    }
  }

  protected parseCommandData(): void {
    return
  }

  protected validationErrorMessage(): string {
    return ''
  }

  protected validate(): boolean {
    return true
  }

  protected successMessage(): string | undefined {
    return undefined
  }

  protected isBasicCommand(): boolean {
    return false
  }

  abstract doExecution(): Promise<unknown>
  abstract availableFor(): Bot[]

  async execute(): Promise<unknown> {
    this.parseBot()

    // if we are executing a basic command, we don't need all of those checks
    if (!this.isBasicCommand()) {
      const availableForBots = this.availableFor()
      if (availableForBots.length === 1) {
        this.bot = availableForBots[0]
      }
      if (this.isUndecided()) {
        return this.telegram.send(
          'Could not find selected bot. Please use `maxi`, `vault-maxi` for vault-maxi and `lm`, `reinvest`, `lm-reinvest` for lm-reinvest',
        )
      }
      if (this.isUnavailable()) {
        return this.telegram.send('This command is not available for selected bot')
      }
      if (this.isBotBusy()) {
        return this.telegram.send('Your bot (' + this.bot + ') is busy. Try again later')
      }
    }
    this.parseCommandData()
    if (this.validate()) {
      return this.doExecution().then(async () => {
        let message = this.successMessage()
        if (message !== undefined) {
          await this.telegram.send(message)
        }
      })
    }
    return this.telegram.send(this.validationErrorMessage())
  }
}
