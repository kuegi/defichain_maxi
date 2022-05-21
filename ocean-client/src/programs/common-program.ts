import { BigNumber } from "@defichain/jellyfish-api-core";
import { CTransactionSegWit, DeFiTransactionConstants, ScriptBalances, TokenBalance, Transaction, TransactionSegWit, Vin, Vout } from "@defichain/jellyfish-transaction";
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
import { calculateFeeP2WPKH } from '@defichain/jellyfish-transaction-builder/dist/txn/txn_fee'
import { Prevout } from '@defichain/jellyfish-transaction-builder/dist/provider'
import { WalletClassic } from "@defichain/jellyfish-wallet-classic";

export enum ProgramState {
    Idle = "idle",
    WaitingForTransaction = "waiting-for-transaction",
    Error = "error-occured",
}

export class CommonProgram {
    protected readonly settings: StoredSettings
    protected readonly store: Store
    private readonly client: WhaleApiClient
    private readonly walletSetup: WalletSetup
    private account: WhaleWalletAccount | undefined

    pendingTx : string|undefined

    constructor(store: Store, walletSetup: WalletSetup) {
        this.settings = store.settings
        this.store = store
        this.client = walletSetup.client
        this.walletSetup= walletSetup
    }

    async init(): Promise<boolean> {
        this.account= await this.walletSetup.getAccount(this.settings.address)
        return true
    }

    async doValidationChecks(telegram: Telegram): Promise<boolean> {
        if (!this.account) {
            const message = "Could not initialize wallet. Check your settings! "
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

    async getTokenBalances(): Promise<Map<string, AddressToken>> {
        const tokens = await this.client.address.listToken(await this.getAddress(), 100)

        return new Map(tokens.map(token => [token.symbol, token]))
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

    async getPool(poolId: string): Promise<PoolPairData | undefined> {
        const respose = await this.client.poolpairs.list(1000)

        return respose.find(pool => {
            return pool.symbol == poolId
        })
    }

    async getFixedIntervalPrice(token: string): Promise<ActivePrice> {
        let response = await this.client.prices.getFeedActive(token, "USD", 10)
        return response[0]
    }

    async getToken(token: string): Promise<TokenData> {
        return this.client.tokens.get(token)
    }

    async getBlockHeight(): Promise<number> {
        return (await this.client.stats.get()).count.blocks
    }

    async removeLiquidity(poolId: number, amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransactionSegWit> {
        const script = await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().liqPool.removeLiquidity({
            script: script,
            tokenId: poolId,
            amount: amount
        }
            , script)
        return this.sendWithPrevout(txn, prevout)
    }

    async addLiquidity(amounts: TokenBalance[], prevout: Prevout | undefined = undefined): Promise<CTransactionSegWit> {
        const script = await this.account!.getScript()
        let txn = await this.account!.withTransactionBuilder().liqPool.addLiquidity({
            from: [{
                script: script,
                balances: amounts
            }],
            shareAddress: script
        }
            , script)
        return this.sendWithPrevout(txn, prevout)
    }

    async paybackLoans(amounts: TokenBalance[], prevout: Prevout | undefined = undefined): Promise<CTransactionSegWit> {
        const script = await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().loans.paybackLoan({
            vaultId: this.settings.vault,
            from: script,
            tokenAmounts: amounts
        },
            script)
        return this.sendWithPrevout(txn, prevout)
    }

    async takeLoans(amounts: TokenBalance[], prevout: Prevout | undefined = undefined): Promise<CTransactionSegWit> {
        const script = await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().loans.takeLoan({
            vaultId: this.settings.vault,
            to: script,
            tokenAmounts: amounts
        },
            script)
        return this.sendWithPrevout(txn, prevout)
    }

    async depositToVault(token: number, amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransactionSegWit> {
        const script = await this.account!.getScript()
        const txn = await this.account!.withTransactionBuilder().loans.depositToVault({
            vaultId: this.settings.vault,
            from: script,
            tokenAmount: {
                token: token,
                amount: amount
            }
        }, script)
        return this.sendWithPrevout(txn, prevout)
    }


    async utxoToOwnAccount(amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransactionSegWit> {
        const script = await this.account!.getScript()
        const balances: ScriptBalances[] = [{ script: script, balances: [{ token: 0, amount: amount }] }] //DFI has tokenId 0
        const txn = await this.account!.withTransactionBuilder().account.utxosToAccount({
            to: balances
        }, script)
        return this.sendWithPrevout(txn, prevout)
    }


    async sendWithPrevout(txn: TransactionSegWit, prevout: Prevout | undefined): Promise<CTransactionSegWit> {
        if (prevout) {
            const customTx: Transaction = {
                version: DeFiTransactionConstants.Version,
                vin: [{ txid: prevout.txid, index: prevout.vout, script: { stack: [] }, sequence: 0xffffffff }],
                vout: txn.vout,
                lockTime: 0x00000000
            }
            const fee = calculateFeeP2WPKH(new BigNumber(await this.client.fee.estimate(10)), customTx)
            customTx.vout[1].value = prevout.value.minus(fee)
            let signed = await this.account?.signTx(customTx, [prevout])
            if (!signed) {
                throw new Error("can't sign custom transaction")
            }
            txn = signed
        }
        return this.send(txn, prevout ? 2000 : 0) //initial wait time when depending on other tx
    }

    async send(txn: TransactionSegWit, initialWaitTime: number = 0): Promise<CTransactionSegWit> {
        const ctx = new CTransactionSegWit(txn)
        const hex: string = ctx.toHex()

        console.log("Sending txId: " + ctx.txId)
        let start = initialWaitTime
        const waitTime = 5000
        const txId: string = await new Promise((resolve, error) => {
            let intervalID: NodeJS.Timeout
            const sendTransaction = (): void => {
                this.client.rawtx.send({ hex: hex }).then((txId) => {
                    if (intervalID !== undefined) {
                        clearInterval(intervalID)
                    }                    
                    this.pendingTx= ctx.txId
                    resolve(txId)
                }).catch((e) => {
                    if (start >= waitTime * 3) {
                        if (intervalID !== undefined) {
                            clearInterval(intervalID)
                        }
                        console.log("failed to send tx even after after multiple retries (" + e.error.message + ")")
                        error(e)
                    } else {
                        console.log("error sending tx (" + e.error.message + "). retrying after 5 seconds")
                    }
                })
            }
            setTimeout(() => {
                sendTransaction()
                intervalID = setInterval(() => {
                    start += waitTime
                    sendTransaction()
                }, waitTime)
            }, initialWaitTime)
        })
        return ctx
    }

    async waitForTx(txId: string, startBlock: number= 0): Promise<boolean> {
        // wait max 10 blocks (otherwise the tx won't get in anymore)
        if(startBlock == 0){
            startBlock= await this.getBlockHeight()
        }
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
                    //also check blockcount
                    this.getBlockHeight().then(block => {
                        if(block > startBlock + 10) {
                            console.error("waited 10 blocks for tx. possible a conflict with other UTXOs")
                            if (intervalID !== undefined) {
                                clearInterval(intervalID)
                            }
                            resolve(false)
                        }
                    })
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
