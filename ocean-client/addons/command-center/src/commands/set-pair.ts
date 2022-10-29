import { BotType } from '../utils/available-bot'
import { fetchListOfPoolPairs } from '../utils/helpers'
import { Command, Commands } from './command'

export class SetPair extends Command {
  private pair: string | undefined
  private listOfPairs: string[] = []
  private static usageMessage: string = Commands.SetPair + ' BTC-DFI'

  static description = 'Sets given pair as new lm-reinvest pair.\n' + SetPair.usageMessage

  static descriptionFor(bots: BotType[]): string | undefined {
    if (!bots.includes(BotType.REINVEST)) return undefined
    return SetPair.description
  }

  async prepare() {
    this.listOfPairs = await fetchListOfPoolPairs()
  }

  availableFor(): BotType[] {
    return [BotType.REINVEST]
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      this.pair = this.commandData[1]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please use following\n' + SetPair.usageMessage
  }

  validate(): boolean {
    if (this.pair === undefined) {
      console.log('validate failed')
      console.log('commandData: ' + this.commandData)
      return false
    }
    return this.listOfPairs.indexOf(this.pair) > -1
  }

  successMessage(): string | undefined {
    return `Your ${this.bot?.name}s' token is set to ${this.pair}`
  }

  async doExecution(): Promise<unknown> {
    return this.store.updateLMPair(this.pair!, this.bot)
  }
}
