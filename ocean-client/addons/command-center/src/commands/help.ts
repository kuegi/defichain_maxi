import { ChangeTokenTo } from "./change-token-to";
import { CheckMaxi } from "./check-maxi";
import { Commands } from "./command";
import { Execute } from "./execute";
import { RemoveExposure } from "./remove-exposure";
import { SetRange } from "./set-range";
import { SetReinvest } from "./set-reinvest";
import { SetToken } from "./set-token";
import { Skip } from "./skip";
import { StoreCommand } from "./store-command";

// Krysh: not really nice, but making help command a store command to access our store
export class Help extends StoreCommand {
    name(): string {
        return Commands.Help
    }

    description(): string {
        let checkMaxi = new CheckMaxi(this.telegram)
        let execute = new Execute(this.telegram)
        let skip = new Skip(this.telegram, this.store)
        let removeExposure = new RemoveExposure(this.telegram, this.store)
        let setRange = new SetRange(this.telegram, this.store, [])
        let setReinvest = new SetReinvest(this.telegram, this.store, [])
        let setToken = new SetToken(this.telegram, this.store, [])
        let changeTokenTo = new ChangeTokenTo(this.telegram, this.store, [])

        return "\n\nWelcome to your Command Center.\nHere is a list of available commands\n"
        + "\n" + checkMaxi.name() + "\n" + checkMaxi.description() + "\n"
        + "\n" + execute.name() + "\n" + execute.description() + "\n"
        + "\n" + skip.name() + "\n" + skip.description() + "\n"
        + "\n" + removeExposure.name() + "\n" + removeExposure.description() + "\n"
        + "\n" + setRange.name() + "\n" + setRange.description() + "\n"
        + "\n" + setReinvest.name() + "\n" + setReinvest.description() + "\n"
        + "\n" + changeTokenTo.name() + "\n" + changeTokenTo.description() + "\n"
        + "\n" + setToken.name() + "\n" + setToken.description()
    }

    successMessage(): string | undefined {
        return undefined
    }
    
    doExecution(): Promise<unknown> {
        return this.telegram.send(this.description())
    }
}