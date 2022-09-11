import { MainNet, Network, TestNet } from '@defichain/jellyfish-network'
import { JellyfishWallet, WalletHdNode } from "@defichain/jellyfish-wallet";
import { WalletClassic } from "@defichain/jellyfish-wallet-classic";
import { Bip32Options, MnemonicHdNodeProvider } from "@defichain/jellyfish-wallet-mnemonic";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { WhaleWalletAccount, WhaleWalletAccountProvider } from "@defichain/whale-api-wallet";
import { StoredSettings } from "./store";
import { WIF } from '@defichain/jellyfish-crypto'

export class WalletSetup {
    readonly url: string
    readonly network: Network
    readonly client: WhaleApiClient
    readonly wallet: WalletClassic | JellyfishWallet<WhaleWalletAccount, WalletHdNode>
    private account: WhaleWalletAccount | undefined
    private static NEEDED_SEED_LENGTH = 24

    constructor(settings: StoredSettings, oceanUrl : string = 'https://ocean.defichain.com') {
        const network= WalletSetup.guessNetworkFromAddress(settings.address)
        console.log("using ocean at "+oceanUrl+" on "+network.name)
        this.network= network
        this.url= oceanUrl
        this.client = new WhaleApiClient({
            url: this.url,
            version: 'v0',
            network: network.name
        })
        if (settings.seed && settings.seed.length == 1) {
            this.wallet = new WalletClassic(WIF.asEllipticPair(settings.seed[0]))
            this.account = new WhaleWalletAccount(this.client, this.wallet, network)
        } else {
            this.wallet = new JellyfishWallet(MnemonicHdNodeProvider.fromWords(settings.seed, this.bip32Options(network)),
                new WhaleWalletAccountProvider(this.client, network))
        }
    }

    public isTestnet(): boolean {
        return this.network == TestNet
    }
    
    public static guessNetworkFromAddress(address: string) {
        if(address.startsWith("df1")) {
            return MainNet
        } else if(address.startsWith("tf1")) {
            return TestNet
        }
        console.error("can't guess network from address "+address+" falling back to MainNet")
        return MainNet
    }

    async getAccount(wantedAddress: string): Promise<WhaleWalletAccount | undefined> {
        if (this.account) {
            const address = await this.account.getAddress()
            if (address != wantedAddress) {
                this.account = undefined
            }
        } else {
            const wallet = this.wallet as JellyfishWallet<WhaleWalletAccount, WalletHdNode>
            let accounts = await wallet.discover()
            this.account = undefined
            for (let i = 0; i < accounts.length; i++) {
                const account = accounts[i]
                let address = await account.getAddress()
                if (address == wantedAddress) {
                    this.account = account
                    break
                }
            }
        }
        return this.account
    }

    private bip32Options(network: Network): Bip32Options {
        return {
            bip32: {
                public: network.bip32.publicPrefix,
                private: network.bip32.privatePrefix
            },
            wif: network.wifPrefix
        }
    }

    static canInitializeFrom(settings: StoredSettings): boolean {
        return settings.seed !== undefined && settings.seed.length === WalletSetup.NEEDED_SEED_LENGTH
    }

    // 2022-02-28 Krysh: just here to not lose this information
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
}