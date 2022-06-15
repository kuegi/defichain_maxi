import { fetchListOfPoolPairs } from "../utils/helpers";
import { Commands } from "./command";
import { Skip } from "./skip";
import { RemoveExposure } from "./remove-exposure";
import { StoreParameterCommand } from "./store-parameter-command";
import { Execute } from "./execute";

export class ChangeTokenTo extends StoreParameterCommand {

    private token: string|undefined
    private listOfTokens: string[] = []

    private usageMessage: string = "/changeTokenTo QQQ\nwill result in\ntoken = QQQ"

    async prepare() {
        this.listOfTokens = await fetchListOfPoolPairs()
    }

    parseCommandData(): void {
        if (this.commandData.length === 2) {
            this.token = this.commandData[1]
        }
    }
    
    validationErrorMessage(): string {
        return "Input parameter failed validation. Please use following\n" + this.usageMessage
    }
    
    validate(): boolean {
        if (this.token === undefined) {
            return false
        }
        return this.listOfTokens.indexOf(this.token) > -1
    }
    
    successMessage(): string | undefined {
        return "Your vault-maxis' token is set to " + this.token 
        + ". Previous exposure got removed. Please take care of any unwanted loans via impermament loss by yourself."
    }
    
    name(): string {
        return Commands.ChangeTokenTo
    }
    
    description(): string {
        return "changes your vault-maxi to use a new token. This will automatically trigger a set of steps:\n"
        + "1. sets skip to true to prevent double execution of vault-maxi\n"
        + "2. remove exposure of your current token, which will remove LM tokens and pay back loans (dToken and dUSD). Impermament loss need to be handled manually.\n"
        + "3. change token in the parameter settings\n"
        + "4. trigger a vault-maxi execution to complete the change to a new token\n"
        + "CAREFUL: don't forget to execute " + Commands.SetToken + " on any failsafe bot instances.\n"
        + "example: " + this.usageMessage
    }
    
    async doExecution(): Promise<unknown> {
        if (this.token === undefined) {
            // Krysh: will never be executed, as validation should fail
            return new Promise<void>(resolve => {})
        }

        // 1) set skip to true
        let skip = new Skip(this.telegram, this.store)
        await skip.execute()

        // 2) remove exposure from current configured token
        let removeExposure = new RemoveExposure(this.telegram)
        await removeExposure.execute()

        // 3) update token
        await this.store.updateToken(this.token)
        
        // 4) finally execute again to ensure new token is active
        let execute = new Execute(this.telegram, '{"overrideSettings":{"ignoreSkip": true}}', "Change to " + this.token + " finished successfully.")
        return execute.execute()
    }

} 