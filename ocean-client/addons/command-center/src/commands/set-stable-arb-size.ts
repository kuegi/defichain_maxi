import { BotType } from '../utils/available-bot'
import { isNumber } from '../utils/helpers'
import { Command, Commands } from './command'

export class SetStableArbSize extends Command {
  private batchSize?: string

  private static usageMessage: string = Commands.SetStableArbSize + ' 100'

  static description =
    'sets given number as stable arb batch size.\nYour set amount should be available in your vault as collateral and should be able to be withdrawn. Otherwise vault-maxi will reduce this size on execution automatically, no changes to your stored parameter will be performed.\n' +
    SetStableArbSize.usageMessage

  static descriptionFor(bots: BotType[]): string | undefined {
    if (!bots.includes(BotType.MAXI)) return undefined
    return SetStableArbSize.description
  }

  availableFor(): BotType[] {
    return [BotType.MAXI]
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      this.batchSize = this.commandData[1]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please use following\n' + SetStableArbSize.usageMessage
  }

  validate(): boolean {
    return isNumber(this.batchSize)
  }

  successMessage(): string | undefined {
    return "Your vault-maxis' stable arb batch size is set to " + this.batchSize
  }

  doExecution(): Promise<unknown> {
    return this.store.updateStableArbBatchSize(this.batchSize!, this.bot)
  }
}
