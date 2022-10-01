import { BotType } from '../utils/available-bot'
import { Command } from './command'

export class Resume extends Command {
  static description = 'resumes execution of your vault-maxi'

  static descriptionFor(bots: BotType[]): string | undefined {
    if (!bots.includes(BotType.MAXI)) return undefined
    return Resume.description
  }

  availableFor(): BotType[] {
    return [BotType.MAXI]
  }

  successMessage(): string {
    return `Your ${this.bot?.name} will resume normally`
  }

  doExecution(): Promise<unknown> {
    console.log('executing resume')
    return this.store.updateSkip(false, this.bot)
  }
}
