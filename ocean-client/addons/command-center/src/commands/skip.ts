import { BotType } from '../utils/available-bot'
import { Command } from './command'

export class Skip extends Command {
  static description = 'skips one execution of your vault-maxi'

  static descriptionFor(bots: BotType[]): string | undefined {
    if (!bots.includes(BotType.MAXI)) return undefined
    return Skip.description
  }

  availableFor(): BotType[] {
    return [BotType.MAXI]
  }

  successMessage(): string {
    return `Your ${this.bot?.name} will skip next execution`
  }

  doExecution(): Promise<unknown> {
    console.log('executing skip')
    return this.store.updateSkip(true, this.bot)
  }
}
