import { AvailableBots, Bot } from '../utils/available-bot'
import { Telegram } from '../utils/telegram'
import { Bots } from './bots'
import { Check } from './check'
import { Command, Commands } from './command'
import { Execute } from './execute'
import { RemoveExposure } from './remove-exposure'
import { Resume } from './resume'
import { SetAutoDonation } from './set-auto-donation'
import { SetRange } from './set-range'
import { SetReinvest } from './set-reinvest'
import { SetStableArbSize } from './set-stable-arb-size'
import { Skip } from './skip'

export class Help extends Command {
  private readonly availableBots: AvailableBots

  constructor(telegram: Telegram, availableBots: AvailableBots) {
    super(telegram)
    this.availableBots = availableBots
  }

  private buildLine(command: string, descriptionFunc: (bots: Bot[]) => string | undefined): string {
    const description = descriptionFunc(this.availableBots.getBots())
    if (!description) return ''
    return '\n' + command + '\n' + description + '\n'
  }

  overview(): string {
    return (
      '\n\nWelcome to your Command Center.\nHere is a list of available commands\n' +
      this.buildLine(Commands.Bots, Bots.descriptionFor) +
      this.buildLine(Commands.Check, Check.descriptionFor) +
      this.buildLine(Commands.Execute, Execute.descriptionFor) +
      this.buildLine(Commands.Skip, Skip.descriptionFor) +
      this.buildLine(Commands.Resume, Resume.descriptionFor) +
      this.buildLine(Commands.RemoveExposure, RemoveExposure.descriptionFor) +
      this.buildLine(Commands.SetRange, SetRange.descriptionFor) +
      this.buildLine(Commands.SetReinvest, SetReinvest.descriptionFor) +
      this.buildLine(Commands.SetStableArbSize, SetStableArbSize.descriptionFor) +
      this.buildLine(Commands.SetAutoDonation, SetAutoDonation.descriptionFor)
    )
  }

  successMessage(): string | undefined {
    return undefined
  }

  doExecution(): Promise<unknown> {
    return this.telegram.send(this.overview())
  }
}
