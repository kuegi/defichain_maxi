import { CheckMaxi } from "./check-maxi";
import { Command, Commands } from "./command";
import { RemoveExposure } from "./remove-exposure";
import { Skip } from "./skip";

export class Help extends Command {
    name(): string {
        return Commands.Help
    }

    description(): string {
        let checkMaxi = new CheckMaxi(this.telegram)
        let skip = new Skip(this.telegram)
        let removeExposure = new RemoveExposure(this.telegram)

        return "\n\nWelcome to your Command Center.\nHere is a list of available commands\n"
        + "\n/help\ndisplays all available commands with a short description\n"
        + "\n" + checkMaxi.name() + "\n" + checkMaxi.description() + "\n"
        + "\n" + skip.name() + "\n" + skip.description() + "\n"
        + "\n" + removeExposure.name() + "\n" + removeExposure.description()
    }
    
    doExecution(): Promise<unknown> {
        return this.telegram.send(this.description())
    }
}