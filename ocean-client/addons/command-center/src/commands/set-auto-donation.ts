import { BotType } from '../utils/available-bot'
import { isNumber, multiBotDescriptionFor } from '../utils/helpers'
import { Command, CommandInfo, Commands } from './command'

export class SetAutoDonation extends Command {
  private percentage?: string

  static maxi: CommandInfo = {
    description:
      'sets given percentage as auto-donation percentage for your vault-maxi. THANKS for using auto-donation feature to support us! (0 deactivates auto-donation functionality)',
    usage: Commands.SetAutoDonation + ' maxi 5',
  }

  static reinvest: CommandInfo = {
    description:
      'sets given percentage as auto-donation percentage for your lm-reinvest. THANKS for using auto-donation feature to support us! (0 deactivates auto-donation functionality)',
    usage: Commands.SetAutoDonation + ' reinvest 5',
  }

  static defaultUsage: CommandInfo = {
    description:
      'sets given percentage as auto-donation percentage. THANKS for using auto-donation feature to support us! (0 deactivates auto-donation functionality)',
    usage: Commands.SetAutoDonation + ' 5',
  }

  static descriptionFor(bots: BotType[]): string | undefined {
    return multiBotDescriptionFor(bots, SetAutoDonation.maxi, SetAutoDonation.reinvest, SetAutoDonation.defaultUsage)
  }

  availableFor(): BotType[] {
    return [BotType.MAXI, BotType.REINVEST]
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      this.percentage = this.commandData[1]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please check how to use this command with ' + Commands.Help
  }

  validate(): boolean {
    if (!this.percentage) return false
    return isNumber(this.percentage) && +this.percentage >= -1 && +this.percentage <= 50
  }

  successMessage(): string | undefined {
    const percentageNumber = +this.percentage!
    const activeMessage = `is set to ${this.percentage}. Thanks for supporting us!`
    return `Your ${this.bot?.name}s' auto-donation ${percentageNumber > 0 ? activeMessage : 'is deactivated'}`
  }

  doExecution(): Promise<unknown> {
    return this.store.updateAutoDonation(this.percentage!, this.bot)
  }
}
