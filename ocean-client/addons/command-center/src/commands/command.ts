import { Telegram } from "../utils/telegram"

export enum Commands {
    Help = '/help',
    CheckMaxi = '/checkMaxi',
    Skip = "/skip",
    RemoveExposure = "/removeExposure",
    SetRange = "/setRange",
}

export abstract class Command {
    protected telegram: Telegram

    constructor(telegram: Telegram) {
        this.telegram = telegram
    }

    abstract name(): string
    abstract description(): string
    abstract doExecution(): Promise<unknown>

    async execute(): Promise<unknown> {
        return this.doExecution()
    }
}