import { Network } from "@defichain/jellyfish-network";
import { WalletHdNode, WalletHdNodeProvider } from "@defichain/jellyfish-wallet";
import { Bip32Options, MnemonicHdNodeProvider } from "@defichain/jellyfish-wallet-mnemonic";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { WhaleWalletAccountProvider } from "@defichain/whale-api-wallet";
import { StoredSettings } from "./store";

export class WalletSetup {
    readonly client: WhaleApiClient
    readonly accountProvider: WhaleWalletAccountProvider
    readonly nodeProvider: WalletHdNodeProvider<WalletHdNode>

    constructor(network: Network, settings: StoredSettings) {
        this.client = new WhaleApiClient({
            url: 'https://ocean.defichain.com',
            version: 'v0',
            network: network.name
        })
        this.accountProvider = new WhaleWalletAccountProvider(this.client, network)
        this.nodeProvider = MnemonicHdNodeProvider.fromWords(settings.lw_seed, this.bip32Options(network))
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