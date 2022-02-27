import { WIF } from '@defichain/jellyfish-crypto'
import { TestNet } from '@defichain/jellyfish-network'
import { JellyfishWallet, WalletAccount } from '@defichain/jellyfish-wallet'
import { WalletClassic } from '@defichain/jellyfish-wallet-classic'
import { EncryptedData, EncryptedHdNodeProvider, EncryptedMnemonicHdNode, PrivateKeyEncryption, Scrypt } from '@defichain/jellyfish-wallet-encrypted'
import { MnemonicHdNode, MnemonicHdNodeProvider } from '@defichain/jellyfish-wallet-mnemonic'
import { WhaleApiClient } from '@defichain/whale-api-client'
import { WhaleWalletAccount, WhaleWalletAccountProvider } from '@defichain/whale-api-wallet'
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

    let network = TestNet
    let options = {
        bip32: {
            public: network.bip32.publicPrefix,
            private: network.bip32.privatePrefix
        },
        wif: network.wifPrefix
    }
    let accountProvider = new WhaleWalletAccountProvider(client, network)
    // 2022-02-27 Krysh: Encrypted approach
    // const DEFAULT_SCRYPT_N_R_P = [
    //     Math.pow(2, 9),
    //     8, // decide stress on ram, not to reduce, to remained strong POW
    //     2 // iteration, directly stack up time (if only purely single thread)
    //   ]
    // let scrypt = new Scrypt(...DEFAULT_SCRYPT_N_R_P)
    // let privateKeyEncryption = new PrivateKeyEncryption(scrypt)
    // let providerData = await EncryptedHdNodeProvider.wordsToEncryptedData(settings.lw_seed, options, privateKeyEncryption, settings.lw_passphrase)
    // const promptPassphrase = new Promise<string>(resolve => { return settings.lw_address})
    // let nodeProvider = EncryptedHdNodeProvider.init(providerData, options, privateKeyEncryption, () => promptPassphrase)
    // 2022-02-27 Krysh: mnemonic approach
    let nodeProvider = MnemonicHdNodeProvider.fromWords(settings.lw_seed, options)

    const program = new ReinvestProgram(store, client, nodeProvider, accountProvider)

    const address = await program.getAddress()
    const balance = await program.getUTXOBalance()
    const balanceToken = await program.getTokenBalance('DFI')

    let body = {
        address: address,
        addressSame: settings.lw_address === address,
        balance: balance,
        balanceToken: balanceToken
    }

    // var utxos = await program.getUTXOBalance()
    // console.log("start utxos = " + utxos)
    // var balance = await program.getTokenBalance('DFI')
    // console.log("start balance = " + balance?.amount + " " + balance?.symbol)

    // const success = await program.depositToVault('DFI', new BigNumber(1))

    // utxos = await program.getUTXOBalance()
    // console.log("end utxos = " + utxos)
    // balance = await program.getTokenBalance('DFI')
    // console.log("end balance = " + balance?.amount + " " + balance?.symbol)

    // let body = {
    //     balance: balance,
    //     isTransactionSuccessful: success
    // }

    const response = {
        statusCode: 200,
        body: body
    }
    return response
}