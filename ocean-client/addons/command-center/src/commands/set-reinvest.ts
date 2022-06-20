import { isNumber } from "../utils/helpers";
import { CheckMaxi } from "./check-maxi";
import { Commands } from "./command";
import { StoreParameterCommand } from "./store-parameter-command";

export class SetReinvest extends StoreParameterCommand {

    private reinvest: string|undefined

    private usageMessage: string = "/setReinvest 5\nwill result in\nreinvest = 5"

    parseCommandData(): void {
        if (this.commandData.length === 2) {
            this.reinvest = this.commandData[1]
        }
    }

    validationErrorMessage(): string {
        return "Input parameter failed validation. Please use following\n" + this.usageMessage
    }

    validate(): boolean {
        return isNumber(this.reinvest)
    }

    successMessage(): string | undefined {
        return "Your vault-maxis' reinvest is set to " + this.reinvest
    }

    name(): string {
        return Commands.SetReinvest
    }

    description(): string {
        return "sets given value as reinvest. After changing reinvest it will automatically execute " + Commands.CheckMaxi + " to check if configuration is still valid.\nexample: " + this.usageMessage
    }

    async doExecution(): Promise<unknown> {
        await this.store.updateReinvest(this.reinvest!)
        let checkMaxi = new CheckMaxi(this.telegram)
        return checkMaxi.execute()
    }

}