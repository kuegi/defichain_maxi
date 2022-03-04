import { BigNumber } from "@defichain/jellyfish-api-core";
import { CTransactionSegWit, TokenBalance, TransactionSegWit } from "@defichain/jellyfish-transaction";
import { JellyfishWallet, WalletAccount, WalletHdNode, WalletHdNodeProvider } from "@defichain/jellyfish-wallet";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { LoanVaultActive, LoanVaultLiquidated } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
import { TokenData } from "@defichain/whale-api-client/dist/api/tokens";
import { WhaleWalletAccount, WhaleWalletAccountProvider } from "@defichain/whale-api-wallet";
import { resolve } from "path/posix";
import { isThisTypeNode } from "typescript";
import { delay, isNullOrEmpty } from "../utils/helpers";
import { Store, StoredSettings } from "../utils/store";
import { WalletSetup } from "../utils/wallet-setup";

export class CommonProgram {
    private readonly settings: StoredSettings
    private readonly client: WhaleApiClient
    private readonly wallet: JellyfishWallet<WhaleWalletAccount, WalletHdNode>
    private account: WhaleWalletAccount | undefined

    constructor(settings: StoredSettings, walletSetup: WalletSetup) {
        this.settings = settings
        this.client = walletSetup.client
        this.wallet = new JellyfishWallet(walletSetup.nodeProvider, walletSetup.accountProvider)
    }

    async init(): Promise<boolean> {
        await this.wallet.discover()
        this.account = this.wallet.get(0)
        return true
    }

    async getAddress(): Promise<string> {
        return this.account?.getAddress() ?? ""
    }

    async getUTXOBalance(): Promise<BigNumber> {
        return new BigNumber(await this.client.address.getBalance(await this.getAddress()))
    }

    async getTokenBalances(): Promise<Map<string,AddressToken>> {
        let result= new Map<string,AddressToken>()
        const tokens = await this.client.address.listToken(await this.getAddress(), 100)

        return new Map(tokens.map(token =>[token.symbol,token]))
    }

    async getTokenBalance(symbol: String): Promise<AddressToken | undefined> {
        const tokens = await this.client.address.listToken(await this.getAddress(), 100)

        return tokens.find(token => {
            return token.isDAT && token.symbol === symbol
        })
    }

    async getVault(): Promise<LoanVaultActive | LoanVaultLiquidated> {
        return this.client.loan.getVault(this.settings.vault)
    }

    async getPool(poolId:string):Promise<PoolPairData | undefined> {
        const respose= await this.client.poolpairs.list()
        
        return respose.find(pool => {
            return pool.symbol == poolId
        })
    }

    async getFixedIntervalPrice(token:string):Promise<ActivePrice> {
        let response= await this.client.prices.getFeedActive(token,"USD",10)
        return response[0]
    }

    async getToken(token:string):Promise<TokenData> {
        return this.client.tokens.get(token)
    }

    async removeLiquidity(poolId: number, amount: BigNumber): Promise<string> {
        const script= await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().liqPool.removeLiquidity({
                script: script,
                tokenId: poolId,
                amount: amount
            }
            ,script)
            
        return this.send(txn)
    }

    async addLiquidity(amounts: TokenBalance[]): Promise<string> {
        const script= await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().liqPool.addLiquidity({
            from: [{ 
                script:script, 
                balances:amounts }],
            shareAddress: script
            }
            ,script)
            
        return this.send(txn)
    }

    async paybackLoans(amounts: TokenBalance[]): Promise<string> {
        const script= await this.account!.getScript()
        const txn= await this.account!.withTransactionBuilder().loans.paybackLoan({
                vaultId: this.settings.vault,
                from: script,
                tokenAmounts: amounts
            },
             script)
        return this.send(txn)
    }

    async takeLoans(amounts: TokenBalance[]): Promise<string> {
        const script= await this.account!.getScript()
        const txn= await this.account!.withTransactionBuilder().loans.takeLoan({
                vaultId: this.settings.vault,
                to: script,
                tokenAmounts: amounts
            },
             script)
        return this.send(txn)

    }

    async depositToVault(symbol: string, amount: BigNumber): Promise<boolean> {
        const token = await this.getTokenBalance(symbol)
        if (!token) {
            return false
        }
        const address = await this.account!.getAddress()
        console.log("depositToVault vaultId=" + this.settings.vault + " from=" + address + " token=" + amount + " " + token.symbol)
        const script = await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().loans.depositToVault({
            vaultId: this.settings.vault,
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

    async waitForTx(txId: string): Promise<boolean> {
        const initialTime = 5000
        let start = initialTime
        return await new Promise((resolve) => {
            let intervalID: NodeJS.Timeout
            const callTransaction = (): void => {
                this.client.transactions.get(txId).then((tx) => {
                    if (intervalID !== undefined) {
                        clearInterval(intervalID)
                    }
                    resolve(true)
                }).catch((e) => {
                    if (start >= 300000) {
                        console.error(e)
                        if (intervalID !== undefined) {
                            clearInterval(intervalID)
                        }
                        resolve(false)
                    }
                })
            }
            setTimeout(() => {
                callTransaction()
                intervalID = setInterval(() => {
                    start += 5000
                    callTransaction()
                }, 5000)
            }, initialTime)
        })

    }
}
