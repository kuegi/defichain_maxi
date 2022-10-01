import { MIN_MAXI_VERSION, MIN_REINVEST_VERSION } from '../command-center'
import { AvailableBots, Bot, BotType } from '../utils/available-bot'
import { Store } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { VersionCheck } from '../utils/version-check'

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
  SetPair = '/setPair',
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
    return !this.availableFor().includes(this.bot.type)
  }

  protected isBotBusy(): boolean {
    return !this.bot?.isIdle
  }

  protected isBotIncompatible(): boolean {
    if (!this.bot) return true
    return !VersionCheck.isCompatibleWith(this.bot.name)
  }

  protected parseBot(): void {
    console.log('parseBot', this.commandData)

    const filteredBots = this.availableBots.list().filter((b) => AvailableBots.shortBotName(b) === this.commandData[1])

    if (filteredBots.length === 1) {
      this.bot = filteredBots[0]
      this.commandData.splice(1, 1)
      console.log('parseBot', this.commandData)
    }
  }

  protected doGeneralBotAvailabilityChecks(): void {
    if (!this.isBotUndecided()) return
    // check which bots are available, if only one, we try to execute for that one
    const bots = this.availableBots.list()
    if (bots.length === 1) {
      console.log('doGeneralBotAvailabilityChecks', 'available bots = ', bots[0])
      this.bot = bots[0]
    }

    // if we aren't sure, which bot should be used, but there is only for this command
    // we try using that bot defined in the command
    const availableForBots = this.availableFor()
    if (this.isBotUndecided() && availableForBots.length === 1) {
      console.log('doGeneralBotAvailabilityChecks', 'command bot types = ', availableForBots[0])
      const availableBotsForType = bots.filter((b) => b.type === availableForBots[0])
      if (availableBotsForType.length === 1) {
        console.log('doGeneralBotAvailabilityChecks', 'found one bot for this type', availableBotsForType[0])
        this.bot = availableBotsForType[0]
      } else {
        console.log('doGeneralBotAvailabilityChecks', 'could not find exactly one bot for type', availableForBots[0])
      }
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
  abstract availableFor(): BotType[]

  async execute(): Promise<unknown> {
    // possibility to be a chained command, therefore bot is set before execution
    // no need and no possibility to parse bot again
    if (!this.bot) {
      this.parseBot()
      this.doGeneralBotAvailabilityChecks()
    }

    // if we are executing a basic command, we don't need all of those checks
    if (!this.isInfoCommand()) {
      if (this.isBotUndecided()) {
        return this.telegram.send('Could not find selected bot. Please use `/bots` to see which bots are available')
      }
      if (this.isBotUnavailable()) {
        return this.telegram.send('This command is not available for selected bot')
      }
      if (this.isBotIncompatible()) {
        return await this.telegram.send(
          `\nError: Versions are not compatible.\nPlease check your installed versions. You have ${
            this.bot?.version
          } for your ${this.bot?.type} installed, but you need ${VersionCheck.join(
            MIN_MAXI_VERSION,
          )} for vault-maxi and ${VersionCheck.join(MIN_REINVEST_VERSION)} for lm-reinvest.`,
        )
      }
      if (this.isBotBusy()) {
        return this.telegram.send('Your bot (' + this.bot?.name + ') is busy. Try again later')
      }
    }
    console.log('parsing command data', this.commandData)
    this.parseCommandData()
    if (this.validate()) {
      console.log('command is valid, executing now')
      return this.doExecution()
        .then(async () => {
          let message = this.successMessage()
          if (message !== undefined) {
            await this.telegram.send(message)
          }
        })
        .catch(async (e) => {
          console.log('execution failed')
          console.log(e)
          await this.telegram.send('Something went wrong while executing command, please check logs')
        })
    } else {
      return this.telegram.send(this.validationErrorMessage())
    }
  }
}
