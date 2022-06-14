import { Telegram } from "../utils/telegram"

export enum Commands {
    Help = '/help',
    CheckMaxi = '/checkMaxi',
    Skip = "/skip",
    Execute = "/execute",
    RemoveExposure = "/removeExposure",
    SetRange = "/setRange",
    SetReinvest = "/setReinvest",
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