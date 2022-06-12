import { Store } from "../utils/store";
import { Command, Commands } from "./command";


export class Skip extends Command {

    private store: Store|undefined

    setStore(store: Store) {
        this.store = store
    }

    name(): string {
        return Commands.Skip
    }

    description(): string {
        return "skips one execution of your vault-maxi"
    }

    doExecution(): Promise<unknown> {
        if (this.store === undefined) {
            // Krysh: should never happen
            return new Promise(resolve => {})
        }

        return this.store.updateSkip().then(() => {
            this.telegram.send("Your vault-maxi will skip next execution")
        })
    }
}