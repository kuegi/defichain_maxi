import { CheckMaxi } from "./check-maxi";
import { Command, Commands } from "./command";
import { Execute } from "./execute";
import { RemoveExposure } from "./remove-exposure";
import { Resume } from "./resume";
import { SetRange } from "./set-range";
import { SetReinvest } from "./set-reinvest";
import { Skip } from "./skip";

export class Help extends Command {

    overview(): string {
        return "\n\nWelcome to your Command Center.\nHere is a list of available commands\n"
        + "\n" + Commands.CheckMaxi + "\n" + CheckMaxi.description + "\n"
        + "\n" + Commands.Execute + "\n" + Execute.description + "\n"
        + "\n" + Commands.Skip + "\n" + Skip.description + "\n"
        + "\n" + Commands.Resume + "\n" + Resume.description + "\n"
        + "\n" + Commands.RemoveExposure + "\n" + RemoveExposure.description + "\n"
        + "\n" + Commands.SetRange + "\n" + SetRange.description + "\n"
        + "\n" + Commands.SetReinvest + "\n" + SetReinvest.description + "\n"
    }

    successMessage(): string | undefined {
        return undefined
    }
    
    doExecution(): Promise<unknown> {
        return this.telegram.send(this.overview())
    }
}