import { BigNumber } from "@defichain/jellyfish-api-core";
import { TestNet } from "@defichain/jellyfish-network";
import { CTransactionSegWit, TransactionSegWit } from "@defichain/jellyfish-transaction";
import { JellyfishWallet, WalletEllipticPair, WalletHdNode, WalletHdNodeProvider } from "@defichain/jellyfish-wallet";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { LoanVaultActive, LoanVaultLiquidated } from "@defichain/whale-api-client/dist/api/loan";
import { WhaleWalletAccount, WhaleWalletAccountProvider } from "@defichain/whale-api-wallet";
import { Store } from "../utils/store";

export class CommonProgram {
    private readonly store: Store
    private readonly client: WhaleApiClient
    private readonly wallet: JellyfishWallet<WhaleWalletAccount, WalletHdNode>

    constructor(store: Store, client: WhaleApiClient, nodeProvider: WalletHdNodeProvider<WalletHdNode>, accountProvider: WhaleWalletAccountProvider) {
        this.store = store
        this.client = client
        this.wallet = new JellyfishWallet(nodeProvider, accountProvider)
        this.wallet.discover()
    }

    async getAddress(): Promise<string> {
        return this.wallet.get(0).getAddress()
    }

    async getUTXOBalance(): Promise<BigNumber> {
        return new BigNumber(await this.client.address.getBalance(await this.getAddress()))
    }

    async getTokenBalance(symbol: String): Promise<AddressToken | undefined> {
        const tokens = await this.client.address.listToken(await this.getAddress(), 100)

        return tokens.find(token => {
            return token.isDAT && token.symbol === symbol
        })
    }

    async getVault(): Promise<LoanVaultActive | LoanVaultLiquidated | undefined> {
        const vaults = await this.client.address.listVault(await this.getAddress())
        
        return vaults.find(vault => {
            return vault.vaultId === this.store.settings.vault
        })
    }

    async depositToVault(symbol: string, amount: BigNumber): Promise<boolean> {
        const token = await this.getTokenBalance(symbol)
        if (!token) {
            return false
        }
        const account = await this.wallet.get(0)
        const address = await account.getAddress()
        console.log("depositToVault vaultId=" + this.store.settings.vault + " from=" + address + " token=" + amount + " " + token.symbol)
        const script = await account.getScript()
        const txn = await account.withTransactionBuilder().loans.depositToVault({
            vaultId: this.store.settings.vault,
            from: script,
            tokenAmount: {
                token: parseInt(token?.id),
                amount: amount
            }
        }, script)

        await this.send(txn)
        return true
    }

    async send(txn: TransactionSegWit): Promise<string> {
        const hex: string = new CTransactionSegWit(txn).toHex()
        const txId: string = await this.client.rawtx.send({ hex: hex })
        console.log("Send txId: " + txId)
        return txId
    }
}