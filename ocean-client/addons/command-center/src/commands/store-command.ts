import { Store } from "../utils/store";
import { Telegram } from "../utils/telegram";
import { Command } from "./command";


export abstract class StoreCommand extends Command {
    protected store: Store

    constructor(telegram: Telegram, store: Store) {
        super(telegram)
        this.store = store
    }

    abstract successMessage(): string|undefined

    async execute(): Promise<unknown> {
        return super.execute().then(() => {
            let message = this.successMessage()
            if (message !== undefined) {
                this.telegram.send(message)   
            }
        })
    }
}