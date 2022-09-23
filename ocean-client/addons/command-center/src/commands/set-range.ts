import { Bot } from '../utils/available-bot'
import { isNumber } from '../utils/helpers'
import { Check } from './check'
import { Command, Commands } from './command'

export class SetRange extends Command {
  private minCollateralRatio: string | undefined
  private maxCollateralRatio: string | undefined

  private static usageMessage: string = Commands.SetRange + ' 170-175 or ' + Commands.SetRange + ' 170 175'

  static description =
    'sets given range as min-collateral-ratio and max-collateral-ratio. After changing range it will automatically execute ' +
    Commands.Check +
    ' to check if configuration is still valid.\n' +
    SetRange.usageMessage

  static descriptionFor(bots: Bot[]): string | undefined {
    if (!bots.includes(Bot.MAXI)) return undefined
    return SetRange.description
  }

  availableFor(): Bot[] {
    return [Bot.MAXI]
  }

  parseCommandData(): void {
    if (this.commandData.length === 2) {
      let parameterData = this.commandData[1].split('-')
      this.minCollateralRatio = parameterData[0]
      this.maxCollateralRatio = parameterData[1]
    } else if (this.commandData.length === 3) {
      this.minCollateralRatio = this.commandData[1]
      this.maxCollateralRatio = this.commandData[2]
    }
  }

  validationErrorMessage(): string {
    return 'Input parameter failed validation. Please use following\n' + SetRange.usageMessage
  }

  validate(): boolean {
    return (
      isNumber(this.minCollateralRatio) &&
      isNumber(this.maxCollateralRatio) &&
      this.safetyChecks(this.minCollateralRatio, this.maxCollateralRatio)
    )
  }

  successMessage(): string | undefined {
    return "Your vault-maxis' range is set to " + this.minCollateralRatio + '-' + this.maxCollateralRatio
  }

  async doExecution(): Promise<unknown> {
    await this.store.updateRange(this.minCollateralRatio!, this.maxCollateralRatio!)
    let checkMaxi = new Check(this.telegram, this.store, this.availableBots, this.commandData)
    checkMaxi.setBot(this.bot)
    return checkMaxi.execute()
  }

  private safetyChecks(min: string | undefined, max: string | undefined): boolean {
    if (min === undefined || max === undefined) {
      return false
    }
    let minValue = Number(min)
    let maxValue = Number(max)
    const minRange = 2
    return minValue + minRange <= maxValue
  }
}
