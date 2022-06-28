import { isNumber } from "../utils/helpers";
import { CheckMaxi } from "./check-maxi";
import { Commands } from "./command";
import { StoreParameterCommand } from "./store-parameter-command";

export class SetRange extends StoreParameterCommand {

    private minCollateralRatio: string|undefined
    private maxCollateralRatio: string|undefined

    private static usageMessage: string = "/setRange 170-175 or /setRange 170 175\nwill result in\nmin-collateral-ratio = 170\nmax-collateral-ratio = 175"

    static description = "sets given range as min-collateral-ratio and max-collateral-ratio. After changing range it will automatically execute " + Commands.CheckMaxi + " to check if configuration is still valid.\nexample: " + SetRange.usageMessage

    parseCommandData(): void {
        if (this.commandData.length === 2) {
            let parameterData = this.commandData[1].split("-")
            this.minCollateralRatio = parameterData[0]
            this.maxCollateralRatio = parameterData[1]
        } else if (this.commandData.length === 3) {
            this.minCollateralRatio = this.commandData[1]
            this.maxCollateralRatio = this.commandData[2]
        }
    }

    validationErrorMessage(): string {
        return "Input parameter failed validation. Please use following\n" + SetRange.usageMessage
    }

    validate(): boolean {
        return isNumber(this.minCollateralRatio) &&
                isNumber(this.maxCollateralRatio) &&
                this.safetyChecks(this.minCollateralRatio, this.maxCollateralRatio)
    }

    successMessage(): string | undefined {
        return "Your vault-maxis' range is set to " + this.minCollateralRatio + "-" + this.maxCollateralRatio
    }

    async doExecution(): Promise<unknown> {
        await this.store.updateRange(this.minCollateralRatio!, this.maxCollateralRatio!)
        let checkMaxi = new CheckMaxi(this.telegram)
        return checkMaxi.execute()
    }

    private safetyChecks(min: string|undefined, max: string|undefined): boolean {
        if (min === undefined || max === undefined) {
            return false
        }
        let minValue = Number(min)
        let maxValue = Number(max)
        const minRange = 2
        return minValue + minRange <= maxValue
    }

}