import { isNumber } from "../utils/helpers";
import { Commands } from "./command";
import { StoreParameterCommand } from "./store-parameter-command";

export class SetStableArbSize extends StoreParameterCommand {

    private batchSize?: string

    private static usageMessage: string = Commands.SetStableArbSize + " 100\nwill result in stable arb batch size = 100"

    static description = "sets given number as stable arb batch size.\nYour set amount should be available in your vault as collateral and should be able to be withdrawn. Otherwise vault-maxi will reduce this size on execution automatically, no changes to your stored parameter will be performed.\nexample: " + SetStableArbSize.usageMessage

    parseCommandData(): void {
        if (this.commandData.length === 2) {
            this.batchSize = this.commandData[1]
        }
    }

    validationErrorMessage(): string {
        return "Input parameter failed validation. Please use following\n" + SetStableArbSize.usageMessage
    }

    validate(): boolean {
        return isNumber(this.batchSize)
    }

    successMessage(): string | undefined {
        return "Your vault-maxis' stable arb batch size is set to " + this.batchSize
    }

    doExecution(): Promise<unknown> {
        return this.store.updateStableArbBatchSize(this.batchSize!)
    }

}