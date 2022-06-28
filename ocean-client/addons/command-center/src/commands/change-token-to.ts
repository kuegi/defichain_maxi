import { fetchListOfPoolPairs } from "../utils/helpers";
import { Commands } from "./command";
import { Skip } from "./skip";
import { StoreParameterCommand } from "./store-parameter-command";
import { Execute } from "./execute";
import { Resume } from "./resume";

export class ChangeTokenTo extends StoreParameterCommand {

    private token: string|undefined
    private oldToken: string|undefined
    private listOfTokens: string[] = []
    private static usageMessage: string = "/changeTokenTo QQQ\nwill result in\ntoken = QQQ"

    static description = "changes your vault-maxi to use a new token. This will automatically trigger a set of steps:\n"
    + "1. sets skip to true to prevent double execution of vault-maxi\n"
    + "2. remove exposure of your current token, which will remove LM tokens and pay back loans (dToken and dUSD). Impermament loss need to be handled manually.\n"
    + "3. change token in the parameter settings\n"
    + "4. sets skip to false to resume execution of vault-maxi without an unnecessary skip\n"
    + "CAREFUL: don't forget to execute " + Commands.SetToken + " on any failsafe bot instances.\n"
    + "example: " + ChangeTokenTo.usageMessage

    async prepare() {
        this.listOfTokens = await fetchListOfPoolPairs()
    }

    setOldToken(oldToken: string) {
        this.oldToken = oldToken
    }

    parseCommandData(): void {
        if (this.commandData.length === 2) {
            this.token = this.commandData[1]
        }
    }
    
    validationErrorMessage(): string {
        return "Input parameter failed validation. Please use following\n" + ChangeTokenTo.usageMessage
    }
    
    validate(): boolean {
        if (this.token === undefined || this.oldToken === undefined) {
            console.log("validate failed")
            console.log("token: " + this.token)
            console.log("oldToken: " + this.oldToken)
            return false
        }
        return this.listOfTokens.indexOf(this.token) > -1
    }
    
    successMessage(): string | undefined {
        return "Your vault-maxis' token is set to " + this.token 
        + ". Previous exposure got removed. Please take care of any unwanted loans via impermament loss by yourself."
    }
    
    async doExecution(): Promise<unknown> {
        // 1) set skip to true
        let skip = new Skip(this.telegram, this.store)
        await skip.execute()

        // 2) remove exposure from current configured token
        let removeExposure = new Execute(
            this.telegram, 
            '{"overrideSettings":{"ignoreSkip": true, "maxCollateralRatio": "-1", "LMToken": "' + this.oldToken! + '"}}', 
            "removeExposure execution done"
        )
        await removeExposure.execute()

        // 3) update token
        console.log("updating token")
        await this.store.updateToken(this.token!)
        
        // 4) set skip to false
        let resume = new Resume(this.telegram, this.store)
        return resume.execute()
    }

} 