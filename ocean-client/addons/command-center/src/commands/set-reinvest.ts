import { BotType } from '../utils/available-bot'
import { isNumber, multiBotDescriptionFor } from '../utils/helpers'
import { Command, CommandInfo, Commands } from './command'

export class SetReinvest extends Command {
  private reinvest: string | undefined

  static maxi: CommandInfo = {
    description: 'sets given value as reinvest for your vault-maxi',
    usage: Commands.SetReinvest + ' maxi 5',
  }

  static reinvest: CommandInfo = {
    description: 'sets given value as reinvest for your lm-reinvest',
    usage: Commands.SetReinvest + ' reinvest 5',
  }

  static defaultUsage: CommandInfo = {
    description: 'sets given value as reinvest',
    usage: Commands.SetReinvest + ' 5',
  }

  static descriptionFor(bots: BotType[]): string | undefined {
    return multiBotDescriptionFor(bots, SetReinvest.maxi, SetReinvest.reinvest, SetReinvest.defaultUsage)
  }

  availableFor(): BotType[] {
    return [BotType.MAXI, BotType.REINVEST]
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      this.reinvest = this.commandData[1]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please check how to use this command with ' + Commands.Help
  }

  validate(): boolean {
    return isNumber(this.reinvest)
  }

  successMessage(): string | undefined {
    return 'Your ' + this.bot + "s' reinvest is set to " + this.reinvest
  }

  async doExecution(): Promise<unknown> {
    return this.store.updateReinvest(this.reinvest!, this.bot)
  }
}
