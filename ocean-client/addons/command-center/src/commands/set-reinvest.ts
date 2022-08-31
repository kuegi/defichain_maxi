import { Bot } from '../utils/available-bot'
import { isNumber } from '../utils/helpers'
import { Check } from './check'
import { Commands } from './command'
import { StoreParameterCommand } from './store-parameter-command'

export class SetReinvest extends StoreParameterCommand {
  private reinvest: string | undefined

  private static usageMessage: string = '/setReinvest 5\nwill result in\nreinvest = 5'

  static description =
    'sets given value as reinvest. After changing reinvest it will automatically execute ' +
    Commands.Check +
    ' to check if configuration is still valid.\nexample: ' +
    SetReinvest.usageMessage

  static descriptionFor(bots: Bot[]): string {
    // TODO: Krysh: multi bot description
    return this.description
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      this.reinvest = this.commandData[1]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please use following\n' + SetReinvest.usageMessage
  }

  validate(): boolean {
    return isNumber(this.reinvest)
  }

  successMessage(): string | undefined {
    return "Your vault-maxis' reinvest is set to " + this.reinvest
  }

  async doExecution(): Promise<unknown> {
    await this.store.updateReinvest(this.reinvest!)
    let checkMaxi = new Check(this.telegram)
    return checkMaxi.execute()
  }
}
