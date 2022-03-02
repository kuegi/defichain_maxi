import fetch from "node-fetch"

export class Telegram {
    chatId: string = ""
    token: string = ""
    logChatId: string = ""
    logToken: string = ""
    endpoint: string = 'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message'

    async send(message: string): Promise<unknown> {
        if (this.chatId.length === 0 || this.token.length === 0) {
            return new Promise(resolve => null)
        }
        return this.internalSend(message, this.chatId, this.token)
    }

    async log(message: string): Promise<unknown> {
        if (this.logChatId.length === 0 || this.logToken.length === 0) {
            return new Promise(resolve => null)
        }
        return this.internalSend(message, this.logChatId, this.logToken)
    }

    async internalSend(message: string, chatId: string, token: string): Promise<unknown> {
        let endpointUrl = this.endpoint
            .replace('%token', token)
            .replace('%chatId', chatId)
            .replace('%message', encodeURI(message))
        
        const response = await fetch(endpointUrl)
        return await response.json()
    }
}