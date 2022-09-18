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
    this.commandData = commandData
  }

  public setBot(bot?: Bot): void {
    this.bot = bot
  }

  protected isBotUndecided(): boolean {
    return this.bot === undefined
  }

  protected isBotUnavailable(): boolean {
    if (!this.bot) return true
    return !this.availableFor().includes(this.bot)
  }

  protected isBotBusy(): boolean {
    return !this.availableBots.getBotDataFor(this.bot)?.isIdle
  }

  protected parseBot(): void {
    console.log('parseBot', this.commandData)
    let botViaCommandFound = false
    switch (this.commandData[1]) {
      case 'maxi':
      case 'vault-maxi':
        this.bot = Bot.MAXI
        botViaCommandFound = true
        break
      case 'lm':
      case 'reinvest':
      case 'lm-reinvest':
        this.bot = Bot.REINVEST
        botViaCommandFound = true
        break
    }

    if (botViaCommandFound) {
      this.commandData.splice(1, 1)
      console.log('parseBot', this.commandData)
    }
  }

  protected doGeneralBotAvailabilityChecks(): void {
    // check which bots are available, if only one, we try to execute for that one
    const bots = this.availableBots.getBots()
    if (bots.length === 1) {
      console.log('doGeneralBotAvailabilityChecks', 'available bots = ', bots[0])
      this.bot = bots[0]
    }

    // if we aren't sure, which bot should be used, but there is only for this command
    // we try using that bot defined in the command
    const availableForBots = this.availableFor()
    if (this.isBotUndecided() && availableForBots.length === 1) {
      console.log('doGeneralBotAvailabilityChecks', 'command bots = ', availableForBots[0])
      this.bot = availableForBots[0]
    }

    console.log('doGeneralBotAvailabilityChecks', 'bot = ', this.bot)
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

  protected isInfoCommand(): boolean {
    return false
  }

  abstract doExecution(): Promise<unknown>
  abstract availableFor(): Bot[]

  async execute(): Promise<unknown> {
    // possibility to be a chained command, therefore bot is set before execution
    // no need and no possibility to parse bot again
    if (!this.bot) {
      this.doGeneralBotAvailabilityChecks()
      this.parseBot()
    }

    // if we are executing a basic command, we don't need all of those checks
    if (!this.isInfoCommand()) {
      if (this.isBotUndecided()) {
        return this.telegram.send(
          'Could not find selected bot. Please use `maxi`, `vault-maxi` for vault-maxi and `lm`, `reinvest`, `lm-reinvest` for lm-reinvest',
        )
      }
      if (this.isBotUnavailable()) {
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
    } else {
      return this.telegram.send(this.validationErrorMessage())
    }
  }
}
