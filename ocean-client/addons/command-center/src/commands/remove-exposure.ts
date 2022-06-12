import { Store } from "../utils/store";
import { Commands } from "./command";
import { StoreCommand } from "./store-command";

export class RemoveExposure extends StoreCommand {

    name(): string {
        return Commands.RemoveExposure
    }

    description(): string {
        return "sets max-collateral-ratio to -1, which will remove exposure available to your vault-maxi. Removes all LM tokens and pays back loans. Be cautious of impermanent loss, which will still be left and need to be taken care manually"
    }

    successMessage(): string {
        return "Your vault-maxis' max collateral ratio is set to -1"
    }

    doExecution(): Promise<unknown> {
        return this.store.removeExposure()
    }

}