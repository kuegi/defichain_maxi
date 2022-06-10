import { CheckMaxi } from "./check-maxi";
import { Command, Commands } from "./command";
import { Skip } from "./skip";

export class Help extends Command {
    name(): string {
        return Commands.Help
    }

    description(): string {
        let checkMaxi = new CheckMaxi(this.telegram)
        let skip = new Skip(this.telegram)

        return "\n\nWelcome to your Command Center.\nHere is a list of available commands\n"
        + "\n/help\ndisplays all available commands with a short description\n"
        + "\n" + checkMaxi.name() + "\n" + checkMaxi.description() + "\n"
        + "\n" + skip.name() + "\n" + skip.description()
    }
    
    doExecution(): Promise<unknown> {
        return this.telegram.send(this.description())
    }
}