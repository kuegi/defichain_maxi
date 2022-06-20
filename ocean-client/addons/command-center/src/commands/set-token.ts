import { fetchListOfPoolPairs } from "../utils/helpers";
import { Commands } from "./command";
import { Skip } from "./skip";
import { StoreParameterCommand } from "./store-parameter-command";

export class SetToken extends StoreParameterCommand {

    private token: string|undefined
    private listOfTokens: string[] = []

    private usageMessage: string = "/setToken QQQ\nwill result in\ntoken = QQQ"

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
    }

    name(): string {
        return Commands.SetToken
    }

    description(): string {
        return "sets given value as token. Will check available tickers if given value is possible. Will automatically " + Commands.Skip + " one execution of your vault-maxi.\n"
        + "example:" + this.usageMessage + "\n"
        + "!------------------!\n"
        + "!     ATTENTION     !\n" // Krysh: I know it might look weird in some editors, but on telegram that extra space is needed
        + "!------------------!\n" 
        + "this is only supposed to be called on failsafe bot instances, if you have called " + Commands.ChangeTokenTo + " on your main vault-maxi."
    }

    async doExecution(): Promise<unknown> {
        let skip = new Skip(this.telegram, this.store)
        await skip.execute()

        return this.store.updateToken(this.token!)
    }

}