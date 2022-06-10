import { Command, Commands } from "./command";

export class CheckMaxi extends Command {
    name(): string {
        return Commands.CheckMaxi
    }

    description(): string {
        return "executes check-setup on your vault maxi"
    }

    doExecution(): Promise<unknown> {
        throw new Error("Method not implemented.");
    }
}