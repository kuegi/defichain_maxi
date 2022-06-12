import { Store } from "../utils/store";
import { Command, Commands } from "./command";

export class RemoveExposure extends Command {

    private store: Store|undefined

    setStore(store: Store) {
        this.store = store
    }

    name(): string {
        return Commands.RemoveExposure
    }

    description(): string {
        return "sets max-collateral-ratio to -1, which will remove exposure available to your vault-maxi. Removes all LM tokens and pays back loans. Be cautious of impermanent loss, which will still be left and need to be taken care manually"
    }

    doExecution(): Promise<unknown> {
        if (this.store === undefined) {
            // Krysh: should never happen
            return new Promise(resolve => {})
        }
        
        return this.store.removeExposure().then(() => {
            this.telegram.send("Your vault-maxis' max collateral ratio is set to -1")
        })
    }

}