import { Telegram } from "../utils/telegram"

export enum Commands {
    Help = '/help',
    CheckMaxi = '/checkMaxi',
    Skip = "/skip",
    Resume = "/resume",
    Execute = "/execute",
    RemoveExposure = "/removeExposure",
    SetRange = "/setRange",
    SetReinvest = "/setReinvest",
    SetToken = "/setToken",
    ChangeTokenTo = "/changeTokenTo",
    SetAutoDonation = "/setAutoDonation",
    SetStableArbSize = "/setStableArbSize",
}

export abstract class Command {
    protected telegram: Telegram

    constructor(telegram: Telegram) {
        this.telegram = telegram
    }

    abstract doExecution(): Promise<unknown>

    async execute(): Promise<unknown> {
        return this.doExecution()
    }
}