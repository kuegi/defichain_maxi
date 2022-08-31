import { Bot } from '../utils/available-bot'
import { StoreCommand } from './store-command'

export class Resume extends StoreCommand {
  static description = 'resumes execution of your vault-maxi'

  static descriptionFor(bots: Bot[]): string | undefined {
    if (!bots.includes(Bot.MAXI)) return undefined
    return this.description
  }

  successMessage(): string {
    return 'Your vault-maxi will resume normally'
  }

  doExecution(): Promise<unknown> {
    console.log('executing resume')
    return this.store.updateSkip(false)
  }
}
