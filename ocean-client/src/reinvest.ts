import { Elliptic } from '@defichain/jellyfish-crypto'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { WalletClassic } from '@defichain/jellyfish-wallet-classic'
import { WhaleApiClient } from '@defichain/whale-api-client'
import { ReinvestProgram } from './programs/reinvest-program'
import { Logger } from './utils/logger'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'

/**
 * Initialize WhaleApiClient connected to ocean.defichain.com/v0
 */
const client = new WhaleApiClient({
    url: 'https://ocean.defichain.com',
    version: 'v0',
    network: 'testnet'
})

export async function main(): Promise<Object> {
    var stats = await client.stats.get()

    const store = new Store()
    let settings = await store.fetchSettings()

    const telegram = new Telegram()
    telegram.logChatId = settings.logChatId
    telegram.logToken = settings.logToken

    Logger.default.setTelegram(telegram)

    // TODO: 2022-02-25 Krysh: fix wallet initialisation
    const keyBuffer = Buffer.from(settings.key)
    const wallet = new WalletClassic(Elliptic.fromPrivKey(keyBuffer))
    const program = new ReinvestProgram(store, client, wallet)

    var utxos = await program.getUTXOBalance()
    console.log("start utxos = " + utxos)
    var balance = await program.getTokenBalance('DFI')
    console.log("start balance = " + balance?.amount + " " + balance?.symbol)

    const success = await program.depositToVault('DFI', new BigNumber(1))

    utxos = await program.getUTXOBalance()
    console.log("end utxos = " + utxos)
    balance = await program.getTokenBalance('DFI')
    console.log("end balance = " + balance?.amount + " " + balance?.symbol)

    let body = {
        balance: balance,
        isTransactionSuccessful: success
    }

    const response = {
        statusCode: 200,
        body: body
    }
    return response
}