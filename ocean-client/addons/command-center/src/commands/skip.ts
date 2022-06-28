import { StoreCommand } from "./store-command";

export class Skip extends StoreCommand {
    
    static description = "skips one execution of your vault-maxi"

    successMessage(): string {
        return "Your vault-maxi will skip next execution"
    }

    doExecution(): Promise<unknown> {
        console.log("executing skip")
        return this.store.updateSkip()
    }
}