import fetch from "node-fetch"
import { isNullOrEmpty } from "./helpers"

export class Telegram {
    prefix:string= "[VaultMaxi]"
    chatId: string = ""
    token: string = ""
    logChatId: string = ""
    logToken: string = ""
    endpoint: string = 'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message'

    async send(message: string): Promise<unknown> {
        if (isNullOrEmpty(this.chatId) || isNullOrEmpty(this.token)) {
            return new Promise(resolve => null)
        }
        return this.internalSend(message, this.chatId, this.token)
    }

    async log(message: string): Promise<unknown> {
        if (isNullOrEmpty(this.logChatId) || isNullOrEmpty(this.logToken)) {
            return new Promise(resolve => null)
        }
        return this.internalSend(message, this.logChatId, this.logToken)
    }

    async internalSend(message: string, chatId: string, token: string): Promise<unknown> {
        let endpointUrl = this.endpoint
            .replace('%token', token)
            .replace('%chatId', chatId)
            .replace('%message', encodeURI(this.prefix+" "+message))
        
        const response = await fetch(endpointUrl)
        return await response.json()
    }
}