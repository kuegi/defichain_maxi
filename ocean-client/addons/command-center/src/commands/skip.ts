import { Bot } from '../utils/available-bot'
import { Command } from './command'

export class Skip extends Command {
  static description = 'skips one execution of your vault-maxi'

  static descriptionFor(bots: Bot[]): string | undefined {
    if (!bots.includes(Bot.MAXI)) return undefined
    return Skip.description
  }

  availableFor(): Bot[] {
    return [Bot.MAXI]
  }

  successMessage(): string {
    return 'Your vault-maxi will skip next execution'
  }

  doExecution(): Promise<unknown> {
    console.log('executing skip')
    return this.store.updateSkip()
  }
}
