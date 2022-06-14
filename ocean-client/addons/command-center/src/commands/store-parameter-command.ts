import { Store } from "../utils/store";
import { Telegram } from "../utils/telegram";
import { StoreCommand } from "./store-command";

export abstract class StoreParameterCommand extends StoreCommand {

    protected commandData: string[] = []

    constructor(telegram: Telegram, store: Store, commandData: string[]) {
        super(telegram, store)
        this.commandData = commandData
    }

    abstract parseCommandData(): void
    abstract validationErrorMessage(): string
    abstract validate(): boolean

    async execute(): Promise<unknown> {
        this.parseCommandData()
        if (this.validate()) {
            return super.execute()
        }
        return this.telegram.send(this.validationErrorMessage())
    }
}