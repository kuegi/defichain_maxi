import { BotType } from '../utils/available-bot'
import { Command } from './command'
import { Execute } from './execute'
import { Skip } from './skip'

export class RemoveExposure extends Command {
  static description =
    'Executes your vault-maxi with overridden settings max-collateral-ratio = -1, which will remove exposure available to your vault-maxi. Removes all LM tokens and pays back loans. Be cautious of impermanent loss, which will still be left and need to be taken care manually'

  static descriptionFor(bots: BotType[]): string | undefined {
    if (!bots.includes(BotType.MAXI)) return undefined
    return RemoveExposure.description
  }

  availableFor(): BotType[] {
    return [BotType.MAXI]
  }

  successMessage(): string | undefined {
    return undefined
  }

  async doExecution(): Promise<unknown> {
    let skip = new Skip(this.telegram, this.store, this.availableBots, this.commandData)
    skip.setBot(this.bot)
    await skip.execute()

    console.log('executing remove exposure')
    let execute = new Execute(
      this.telegram,
      this.store,
      this.availableBots,
      this.commandData,
      '{"overrideSettings":{"ignoreSkip": true, "maxCollateralRatio": "-1"}}',
      'removeExposure execution done',
    )
    execute.setBot(this.bot)
    return execute.execute()
  }
}
