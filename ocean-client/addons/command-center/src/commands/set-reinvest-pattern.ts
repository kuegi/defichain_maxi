import { BotType } from '../utils/available-bot'
import { multiBotDescriptionFor } from '../utils/helpers'
import { Command, CommandInfo, Commands } from './command'

export class SetReinvestPattern extends Command {
  private pattern?: string
  private static regex = /^[^:]+(:\d{0,3}(:[a-z0-9]*)?)?([ ,][^:]+(:\d{0,3}(:[a-z0-9]*)?)?)*$/g

  static maxi: CommandInfo = {
    description: 'sets given reinvest pattern for your vault-maxi',
    usage: Commands.SetReinvestPattern + ' maxi DFI:20 BTC',
  }

  static reinvest: CommandInfo = {
    description: 'sets given reinvest pattern for your lm-reinvest',
    usage: Commands.SetReinvestPattern + ' reinvest DFI:20 BTC',
  }

  static defaultUsage: CommandInfo = {
    description: 'sets given reinvest pattern',
    usage: Commands.SetReinvestPattern + ' DFI:20 BTC',
  }

  static descriptionFor(bots: BotType[]): string | undefined {
    return multiBotDescriptionFor(
      bots,
      SetReinvestPattern.maxi,
      SetReinvestPattern.reinvest,
      SetReinvestPattern.defaultUsage,
    )
  }

  availableFor(): BotType[] {
    return [BotType.MAXI, BotType.REINVEST]
  }

  parseCommandData(): void {
    if (this.commandData.length >= 2) {
      this.pattern = this.commandData.slice(1).join(' ')
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please check how to use this command with ' + Commands.Help
  }

  validate(): boolean {
    return (this.pattern?.match(SetReinvestPattern.regex)?.length ?? 0) > 0
  }

  successMessage(): string | undefined {
    return `Your ${this.bot?.name}s' reinvest pattern is set to ${this.pattern}`
  }

  async doExecution(): Promise<unknown> {
    return this.store.updateReinvestPattern(this.pattern!, this.bot)
  }
}
