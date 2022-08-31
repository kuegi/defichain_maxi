import { Bot } from '../utils/available-bot'
import { isNumber } from '../utils/helpers'
import { Commands } from './command'
import { StoreParameterCommand } from './store-parameter-command'

export class SetAutoDonation extends StoreParameterCommand {
  private percentage?: string

  private static usageMessage: string = Commands.SetAutoDonation + ' 5\nwill result in auto donation % = 5%'

  static description =
    'sets given percentage as auto-donation percentage. THANKS for using auto-donation feature to support us! (0 deactivates auto-donation functionality)\nexample: ' +
    SetAutoDonation.usageMessage

  static descriptionFor(bots: Bot[]): string {
    // TODO: Krysh: multi bot description
    return this.description
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      this.percentage = this.commandData[1]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please use following\n' + SetAutoDonation.usageMessage
  }

  validate(): boolean {
    return isNumber(this.percentage)
  }

  successMessage(): string | undefined {
    let percentageNumber = +this.percentage!
    return (
      "Your vault-maxis' auto-donation " +
      (percentageNumber > 0 ? 'is set to ' + this.percentage + '. Thanks for supporting us!' : 'is deactivated')
    )
  }

  doExecution(): Promise<unknown> {
    return this.store.updateAutoDonation(this.percentage!)
  }
}
