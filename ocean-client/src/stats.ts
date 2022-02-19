import { WhaleApiClient } from '@defichain/whale-api-client'

/**
 * Initialize WhaleApiClient connected to ocean.defichain.com/v0
 */
const client = new WhaleApiClient({
    url: 'https://ocean.defichain.com',
    version: 'v0'
})

export async function main (): Promise<Object> {
    var stats = await client.stats.get()

    var result = {
        "blocks": stats.count.blocks,
        "tokens": stats.count.tokens
    }

    const response = {
        statusCode: 200,
        body: result,
    };
    return response
}