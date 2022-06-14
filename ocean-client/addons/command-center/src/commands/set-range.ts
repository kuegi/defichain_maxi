import { Commands } from "./command";
import { StoreParameterCommand } from "./store-parameter-command";

export class SetRange extends StoreParameterCommand {

    private minCollateralRatio: string|undefined
    private maxCollateralRatio: string|undefined

    private usageMessage: string = "/setRange 170-175 or /setRange 170 175\nwill result in\nmin-collateral-ratio = 170\nmax-collateral-ratio = 175"

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
        return "Input parameter failed validation. Please use following\n" + this.usageMessage
    }

    validate(): boolean {
        return this.isNumber(this.minCollateralRatio) &&
                this.isNumber(this.maxCollateralRatio) &&
                this.safetyChecks(this.minCollateralRatio, this.maxCollateralRatio)
    }

    successMessage(): string | undefined {
        return "Your vault-maxis' range is set to " + this.minCollateralRatio + "-" + this.maxCollateralRatio
    }

    name(): string {
        return Commands.SetRange
    }

    description(): string {
        return "sets given range as min-collateral-ratio and max-collateral-ratio\nPLEASE execute " + Commands.CheckMaxi + " after changing range to ensure everything is still configured correctly.\nexample: " + this.usageMessage
    }

    doExecution(): Promise<unknown> {
        if (this.minCollateralRatio === undefined || this.maxCollateralRatio === undefined) {
            // Krysh: will never be executed, as validation should fail
            return new Promise<void>(resolve => {})
        }
        return this.store.updateRange(this.minCollateralRatio, this.maxCollateralRatio)
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

    private isNumber(value: string|undefined): boolean {
        if (value === undefined) {
            return false
        }
        return !isNaN(Number(value))
    }
}