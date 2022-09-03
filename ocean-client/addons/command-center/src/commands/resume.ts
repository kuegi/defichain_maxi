import { Bot } from '../utils/available-bot'
import { Command } from './command'

export class Resume extends Command {
  static description = 'resumes execution of your vault-maxi'

  static descriptionFor(bots: Bot[]): string | undefined {
    if (!bots.includes(Bot.MAXI)) return undefined
    return Resume.description
  }

  availableFor(): Bot[] {
    return [Bot.MAXI]
  }

  successMessage(): string {
    return 'Your vault-maxi will resume normally'
  }

  doExecution(): Promise<unknown> {
    console.log('executing resume')
    return this.store.updateSkip(false)
  }
}
