import { Command, Commands } from "./command";
import { Execute } from "./execute";

export class RemoveExposure extends Command {

    name(): string {
        return Commands.RemoveExposure
    }

    description(): string {
        return "Executes your vault-maxi with overridden settings max-collateral-ratio = -1, which will remove exposure available to your vault-maxi. Removes all LM tokens and pays back loans. Be cautious of impermanent loss, which will still be left and need to be taken care manually"
    }

    doExecution(): Promise<unknown> {
        let execute = new Execute(this.telegram, '{"overrideSettings":{"ignoreSkip": true, "maxCollateralRatio": "-1"}}', "removeExposure execution done")
        return execute.execute()
    }

}