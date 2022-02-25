import { BigNumber } from "@defichain/jellyfish-api-core";
import { TestNet } from "@defichain/jellyfish-network";
import { CTransactionSegWit, TransactionSegWit } from "@defichain/jellyfish-transaction";
import { WalletClassic } from "@defichain/jellyfish-wallet-classic";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { LoanVaultActive, LoanVaultLiquidated } from "@defichain/whale-api-client/dist/api/loan";
import { WhaleWalletAccount } from "@defichain/whale-api-wallet";
import { Store } from "../utils/store";

export class CommonProgram {
    private readonly store: Store
    private readonly client: WhaleApiClient
    private readonly wallet: WalletClassic
    private readonly account: WhaleWalletAccount

    constructor(store: Store, client: WhaleApiClient, wallet: WalletClassic) {
        this.store = store
        this.client = client
        this.wallet = wallet
        this.account = new WhaleWalletAccount(client, wallet, TestNet)
    }

    async getUTXOBalance(): Promise<BigNumber> {
        return new BigNumber(await this.client.address.getBalance(this.store.settings.address))
    }

    async getTokenBalance(symbol: String): Promise<AddressToken | undefined> {
        const tokens = await this.client.address.listToken(this.store.settings.address, 100)

        return tokens.find(token => {
            return token.isDAT && token.symbol === symbol
        })
    }

    async getVault(): Promise<LoanVaultActive | LoanVaultLiquidated | undefined> {
        const vaults = await this.client.address.listVault(this.store.settings.address)
        
        return vaults.find(vault => {
            return vault.vaultId === this.store.settings.vault
        })
    }

    async depositToVault(symbol: string, amount: BigNumber): Promise<boolean> {
        const token = await this.getTokenBalance(symbol)
        if (!token) {
            return false
        }
        const address = await this.account.getAddress()
        console.log("depositToVault vaultId=" + this.store.settings.vault + " from=" + address + " token=" + amount + " " + token.symbol)
        const script = await this.account.getScript()
        const txn = await this.account.withTransactionBuilder().loans.depositToVault({
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