import fetch from 'node-fetch'
import { WhaleApiClient } from '@defichain/whale-api-client'

/**
 * Initialize WhaleApiClient connected to ocean.defichain.com/v0
 */
const client = new WhaleApiClient({
    url: 'https://ocean.defichain.com',
    version: 'v0'
})

class Telegram {
    recipient: string
    token: string
    endpoint: string = 'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message'

    constructor(recipient: string, token: string) {
        this.recipient = recipient
        this.token = token
    }

    async send(message: string): Promise<unknown> {
        let endpointUrl = this.endpoint
            .replace('%token', this.token)
            .replace('%chatId', this.recipient)
            .replace('%message', message)

        const response = await fetch(endpointUrl)
        return await response.json()
    }
}

const telegram = new Telegram("ADD_YOUR_CHANNEL", "ADD_YOUR_TOKEN")

export async function main(): Promise<Object> {
    var stats = await client.stats.get()

    var result = await telegram.send("new block height is " + stats.count.blocks)

    const response = {
        statusCode: 200,
        body: result
    }
    return response
}