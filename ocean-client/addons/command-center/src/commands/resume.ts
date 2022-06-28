import { StoreCommand } from "./store-command";

export class Resume extends StoreCommand {
    
    static description = "resumes execution of your vault-maxi"

    successMessage(): string {
        return "Your vault-maxi will resume normally"
    }

    doExecution(): Promise<unknown> {
        console.log("executing resume")
        return this.store.updateSkip(false)
    }
}