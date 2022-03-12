import { BigNumber } from "@defichain/jellyfish-api-core";
import { CTransactionSegWit, ScriptBalances, TokenBalance, TransactionSegWit } from "@defichain/jellyfish-transaction";
import { JellyfishWallet, WalletHdNode } from "@defichain/jellyfish-wallet";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { LoanVaultActive, LoanVaultLiquidated } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
import { TokenData } from "@defichain/whale-api-client/dist/api/tokens";
import { WhaleWalletAccount } from "@defichain/whale-api-wallet";
import { Store, StoredSettings } from "../utils/store";
import { Telegram } from "../utils/telegram";
import { WalletSetup } from "../utils/wallet-setup";

export enum ProgramState {
    Idle = "idle",
    WaitingForTransaction = "waiting-for-transaction",
    Error = "error-occured",
}

export class CommonProgram {
    protected readonly settings: StoredSettings
    protected readonly store: Store
    private readonly client: WhaleApiClient
    private readonly wallet: JellyfishWallet<WhaleWalletAccount, WalletHdNode>
    private account: WhaleWalletAccount | undefined

    constructor(store: Store, walletSetup: WalletSetup) {
        this.settings = store.settings
        this.store = store
        this.client = walletSetup.client
        this.wallet = new JellyfishWallet(walletSetup.nodeProvider, walletSetup.accountProvider)
    }

    async init(): Promise<boolean> {
        let accounts= await this.wallet.discover()
        for(let i = 0; i < accounts.length;i++) {
            const account = accounts[i]
            let address= await account.getAddress()
            if (address == this.settings.address) {
                this.account = account
                break
            }
        }
        return true
    }

    async doValidationChecks(telegram:Telegram) : Promise<boolean> {
        if(!this.account) {
            const message= "Could not initialize wallet. Check your settings! "
            + this.settings.seed.length + " words in seedphrase,"
            + "trying vault " + this.settings.vault + " in " + this.settings.address + ". "
            await telegram.send(message)
            console.error(message)
            return false
        }
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

    async getBlockHeight(): Promise<number> {
        return (await this.client.stats.get()).count.blocks
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

    async depositToVault(token: number, amount: BigNumber): Promise<string> {
        const script = await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().loans.depositToVault({
            vaultId: this.settings.vault,
            from: script,
            tokenAmount: {
                token: token,
                amount: amount
            }
        }, script)

        return this.send(txn)
    }

    
    async utxoToOwnAccount(amount: BigNumber) : Promise<string> {
        const script = await this.account!.getScript()
        const balances : ScriptBalances[] = [{script:script, balances:[{token:0,amount:amount}]}] //DFI has tokenId 0
        const txn = await this.account!.withTransactionBuilder().account.utxosToAccount({
            to: balances
        }, script)

        return this.send(txn)
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
                    if (start >= 600000) { // 10 min timeout
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
