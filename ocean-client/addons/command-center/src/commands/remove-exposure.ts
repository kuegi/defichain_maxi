import { Commands } from "./command";
import { Execute } from "./execute";
import { Skip } from "./skip";
import { StoreCommand } from "./store-command";

export class RemoveExposure extends StoreCommand {

    successMessage(): string | undefined {
        return undefined
    }

    name(): string {
        return Commands.RemoveExposure
    }

    description(): string {
        return "Executes your vault-maxi with overridden settings max-collateral-ratio = -1, which will remove exposure available to your vault-maxi. Removes all LM tokens and pays back loans. Be cautious of impermanent loss, which will still be left and need to be taken care manually"
    }

    async doExecution(): Promise<unknown> {
        let skip = new Skip(this.telegram, this.store)
        await skip.execute()

        let execute = new Execute(this.telegram, '{"overrideSettings":{"ignoreSkip": true, "maxCollateralRatio": "-1"}}', "removeExposure execution done")
        return execute.execute()
    }

}