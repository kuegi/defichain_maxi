import { WhaleApiClient } from '@defichain/whale-api-client'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'

/**
 * Initialize WhaleApiClient connected to ocean.defichain.com/v0
 */
const client = new WhaleApiClient({
    url: 'https://ocean.defichain.com',
    version: 'v0'
})

export async function main(): Promise<Object> {
    var stats = await client.stats.get()

    const store = new Store()
    let settings = await store.fetchSettings()

    const telegram = new Telegram()
    telegram.logChatId = settings.logChatId
    telegram.logToken = settings.logToken
    const message = "new block height is " + stats.count.blocks + 
    "\nAddress: " + settings.address
    await telegram.log(encodeURI(message))

    let body = {
        chatId: settings.chatId,
        token: settings.token,
        address: settings.address
    }

    const response = {
        statusCode: 200,
        body: body
    }
    return response
}