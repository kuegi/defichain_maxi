import fetch from "node-fetch"
import { isNullOrEmpty } from "./helpers"
import { StoredSettings } from "./store"

export class Telegram {
    private readonly prefix: string = "[VaultMaxi]"
    readonly chatId: string = ""
    readonly token: string = ""
    readonly logChatId: string = ""
    readonly logToken: string = ""
    private readonly endpoint: string = 'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message'

    constructor(settings: StoredSettings, prefix: string = "") {
        this.logChatId = settings.logChatId
        this.logToken = settings.logToken
        this.token = settings.token
        this.chatId = settings.chatId
        this.prefix = prefix
    }

    async send(message: string): Promise<unknown> {
        if (isNullOrEmpty(this.chatId) || isNullOrEmpty(this.token)) {
            return
        }
        return this.internalSend(message, this.chatId, this.token)
    }

    async log(message: string): Promise<unknown> {
        if (isNullOrEmpty(this.logChatId) || isNullOrEmpty(this.logToken)) {
            return
        }
        return this.internalSend(message, this.logChatId, this.logToken)
    }

    async internalSend(message: string, chatId: string, token: string): Promise<unknown> {
        let endpointUrl = this.endpoint
            .replace('%token', token)
            .replace('%chatId', chatId)
            .replace('%message', encodeURI(this.prefix + " " + message))

        const response = await fetch(endpointUrl)
        return await response.json()
    }
}