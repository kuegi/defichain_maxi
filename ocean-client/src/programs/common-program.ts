import { BigNumber } from "@defichain/jellyfish-api-core";
import { AccountToAccount, CAccountToAccount, CTransaction, CTransactionSegWit, DeFiTransactionConstants, fromOPCodes, OP_CODES, OP_DEFI_TX, PoolId, Script, ScriptBalances, TokenBalance, TokenBalanceUInt32, toOPCodes, Transaction, TransactionSegWit, Vin, Vout } from "@defichain/jellyfish-transaction";
import { WhaleApiClient } from "@defichain/whale-api-client";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { LoanToken, LoanVaultActive, LoanVaultLiquidated } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
import { TokenData } from "@defichain/whale-api-client/dist/api/tokens";
import { WhaleWalletAccount } from "@defichain/whale-api-wallet";
import { IStore, StoredSettings } from "../utils/store";
import { Telegram } from "../utils/telegram";
import { WalletSetup } from "../utils/wallet-setup";
import { calculateFeeP2WPKH } from '@defichain/jellyfish-transaction-builder'
import { Prevout } from '@defichain/jellyfish-transaction-builder'
import { SmartBuffer } from 'smart-buffer'
import { fromAddress, fromScript } from '@defichain/jellyfish-address'

export enum ProgramState {
    Idle = "idle",
    WaitingForTransaction = "waiting-for-transaction",
    Error = "error-occured",
}

export class CommonProgram {
    protected readonly settings: StoredSettings
    protected readonly store: IStore
    protected readonly client: WhaleApiClient
    protected readonly walletSetup: WalletSetup
    private account: WhaleWalletAccount | undefined
    private script: Script | undefined

    pendingTx: string | undefined

    constructor(store: IStore, walletSetup: WalletSetup) {
        this.settings = store.settings
        this.store = store
        this.client = walletSetup.client
        this.walletSetup = walletSetup
    }

    // this.account == undefined means that the seed is not owner of this address -> we cannot sign transactions
    // this.script == undefined means that the provided address is invalid
    async init(): Promise<boolean> {
        this.account = await this.walletSetup.getAccount(this.settings.address)
        this.script = fromAddress(this.settings.address, this.walletSetup.network.name)?.script //also does validation of the address
        return true
    }

    public canSign(): boolean {
        return this.account != undefined
    }

    async doValidationChecks(telegram: Telegram, needKey: boolean): Promise<boolean> {
        if (!this.script || (!this.account && needKey)) {
            const message = "Could not initialize wallet. Check your settings! "
                + this.settings.seed.length + " words in seedphrase,"
                + "trying address: " + this.settings.address + ". "
            await telegram.send(message)
            console.error(message)
            return false
        }
        return true
    }

    getAddress(): string {
        return this.script ? this.settings.address : ""
    }

    async getUTXOBalance(): Promise<BigNumber> {
        return new BigNumber(await this.client.address.getBalance(this.getAddress()))
    }

    async getTokenBalances(): Promise<Map<string, AddressToken>> {
        const tokens = await this.client.address.listToken(this.getAddress(), 100)

        return new Map(tokens.map(token => [token.symbol, token]))
    }

    async getTokenBalance(symbol: String): Promise<AddressToken | undefined> {
        const tokens = await this.client.address.listToken(this.getAddress(), 100)

        return tokens.find(token => {
            return token.isDAT && token.symbol === symbol
        })
    }

    async getVault(): Promise<LoanVaultActive | LoanVaultLiquidated> {
        return this.client.loan.getVault(this.settings.vault)
    }

    async getPools(): Promise<PoolPairData[]> {
        return await this.client.poolpairs.list(1000)
    }

    async getPool(poolId: string): Promise<PoolPairData | undefined> {
        const pools = await this.getPools()

        return pools.find(pool => {
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

    async getLoanToken(token: string): Promise<LoanToken> {
        return this.client.loan.getLoanToken(token)
    }

    async getBlockHeight(): Promise<number> {
        return (await this.client.stats.get()).count.blocks
    }

    async removeLiquidity(poolId: number, amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        const txn = await this.account!.withTransactionBuilder().liqPool.removeLiquidity({
            script: this.script!,
            tokenId: poolId,
            amount: amount
        }
            , this.script!)
        return this.sendWithPrevout(txn, prevout)
    }

    async addLiquidity(amounts: TokenBalanceUInt32[], prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        return this.sendOrCreateDefiTx(
            OP_CODES.OP_DEFI_TX_POOL_ADD_LIQUIDITY({
                from: [{
                    script: this.script!,
                    balances: amounts
                }],
                shareAddress: this.script!
            }),
            prevout)
    }

    async paybackLoans(amounts: TokenBalanceUInt32[], prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        const txn = await this.account!.withTransactionBuilder().loans.paybackLoan({
            vaultId: this.settings.vault,
            from: this.script!,
            tokenAmounts: amounts
        },
            this.script!)
        return this.sendWithPrevout(txn, prevout)
    }

    async takeLoans(amounts: TokenBalanceUInt32[], prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        const txn = await this.account!.withTransactionBuilder().loans.takeLoan({
            vaultId: this.settings.vault,
            to: this.script!,
            tokenAmounts: amounts
        },
            this.script!)
        return this.sendWithPrevout(txn, prevout)
    }

    async depositToVault(token: number, amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        const txn = await this.account!.withTransactionBuilder().vault.depositToVault({
            vaultId: this.settings.vault,
            from: this.script!,
            tokenAmount: {
                token: token,
                amount: amount
            }
        }, this.script!)
        return this.sendWithPrevout(txn, prevout)
    }


    async withdrawFromVault(token: number, amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        const txn = await this.account!.withTransactionBuilder().vault.withdrawFromVault({
            vaultId: this.settings.vault,
            to: this.script!,
            tokenAmount: {
                token: token,
                amount: amount
            }
        }, this.script!)
        return this.sendWithPrevout(txn, prevout)
    }


    async utxoToOwnAccount(amount: BigNumber, prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        return this.sendOrCreateDefiTx(
            OP_CODES.OP_DEFI_TX_UTXOS_TO_ACCOUNT({
                to: [{ script: this.script!, balances: [{ token: 0, amount: amount }] }]
            }),
            prevout)
    }


    async sendDFIToAccount(amount: BigNumber, address: string, prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        return this.sendOrCreateDefiTx(
            OP_CODES.OP_DEFI_TX_ACCOUNT_TO_ACCOUNT({
                to: [{ script:  fromAddress(address, this.walletSetup.network.name)!.script, balances: [{ token: 0, amount: amount }] }],
                from: this.script!
            }),
            prevout)
    }

    async swap(amount: BigNumber, fromTokenId: number, toTokenId: number, maxPrice: BigNumber = new BigNumber(999999999), prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        return this.sendOrCreateDefiTx(
            OP_CODES.OP_DEFI_TX_POOL_SWAP({
                fromScript: this.script!,
                fromTokenId: fromTokenId,
                fromAmount: amount,
                toScript: this.script!,
                toTokenId: toTokenId,
                maxPrice: maxPrice
            }),
            prevout)
    }

    async compositeswap(amount: BigNumber, fromTokenId: number, toTokenId: number, pools: PoolId[], maxPrice: BigNumber = new BigNumber(999999999), prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        return this.sendOrCreateDefiTx(
            OP_CODES.OP_DEFI_TX_COMPOSITE_SWAP({
                poolSwap: {
                    fromScript: this.script!,
                    fromTokenId: fromTokenId,
                    fromAmount: amount,
                    toScript: this.script!,
                    toTokenId: toTokenId,
                    maxPrice: maxPrice
                },
                pools: pools
            }),
            prevout)
    }

    async sendOrCreateDefiTx(opDeFiTx: OP_DEFI_TX, prevout: Prevout | undefined = undefined): Promise<CTransaction> {
        const txn = await this.buildDefiTx(opDeFiTx, this.script!, prevout)
        if (this.canSign()) {
            //send directly
            return this.send(txn, prevout ? 3000 : 0) //initial wait time when depending on other tx
        } else {
            return new CTransaction(txn)
        }
    }

    async sendTxDataToTelegram(tx: CTransaction, telegram: Telegram):Promise<void> {
        const message = "Please sign and send :\n" + tx.toHex()
        await telegram.send(message)
    }

    async signAndSendRawTx(rawData:string): Promise<void> {
        const txn= new CTransaction(SmartBuffer.fromBuffer(Buffer.from(rawData,'hex')))
        const defiStack= txn.vout[0].script.stack[1]
        if(defiStack.type === 'OP_DEFI_TX') {
            const dftx= (defiStack as OP_DEFI_TX).tx
            console.log("dftx = "+dftx.name+"("+dftx.type+")")
            switch(dftx.type) {
                case CAccountToAccount.OP_CODE:
                    console.log("got a2a")
                    const a2a= dftx.data as AccountToAccount
                    const from= fromScript(a2a.from,this.walletSetup.network.name)?.address
                    const to= fromScript(a2a.to[0].script,this.walletSetup.network.name)?.address
                    const amount= a2a.to[0].balances[0].amount
                    const token= a2a.to[0].balances[0].token
                    console.log("a2a from: "+from+" to "+to+" : "+amount+"@"+token)
                //lots of cases here
            }
        }

        //todo: probably need prevout: either from data(if ascendant) or getting them from listunspent
        //const signed= await this.account?.signTx(txn,[])
        //this.client.rawtx.send({hex:new CTransaction(signed!).toHex()})
    }

    protected async buildDefiTx(
        opDeFiTx: OP_DEFI_TX,
        changeScript: Script,
        prevout: Prevout | undefined = undefined,
        outValue: BigNumber = new BigNumber('0')): Promise<Transaction> {
        const minFee = outValue.plus(0.001) // see JSDoc above
        let total = new BigNumber(0)
        let prevouts: Prevout[]
        if (prevout === undefined) {
            //TODO: only use necessary unspent
            const unspent = await this.client.address.listTransactionUnspent(this.settings.address, 10)
            prevouts = unspent.map((item): Prevout => {
                total = total.plus(item.vout.value)
                return {
                    txid: item.vout.txid,
                    vout: item.vout.n,
                    value: new BigNumber(item.vout.value),
                    script: {
                        // TODO(fuxingloh): needs to refactor once jellyfish refactor this.
                        stack: toOPCodes(SmartBuffer.fromBuffer(Buffer.from(item.script.hex, 'hex')))
                    },
                    tokenId: item.vout.tokenId ?? 0x00
                }
            })
        } else {
            prevouts = [prevout]
            total = prevout.value
        }
        const vin = prevouts.map((prevout: Prevout): Vin => {
            return {
                txid: prevout.txid,
                index: prevout.vout,
                script: { stack: [] },
                sequence: 0xffffffff
            }
        })

        const deFiOut: Vout = {
            value: outValue,
            script: {
                stack: [OP_CODES.OP_RETURN, opDeFiTx]
            },
            tokenId: 0x00
        }

        const change: Vout = {
            value: total,
            script: changeScript,
            tokenId: 0x00
        }

        const txn: Transaction = {
            version: DeFiTransactionConstants.Version,
            vin: vin,
            vout: [deFiOut, change],
            lockTime: 0x00000000
        }

        //no need to estimate, we are fine with minimum fee
        const fee = calculateFeeP2WPKH(new BigNumber(0.00001), txn)
        change.value = total.minus(outValue).minus(fee)

        if (this.canSign()) {
            const signed = await this.account!.signTx(txn, prevouts)
            if (!signed) {
                throw new Error("can't sign custom transaction")
            }
            return signed
        } else {
            return txn
        }
    }

    async sendWithPrevout(txn: Transaction, prevout: Prevout | undefined): Promise<CTransaction> {
        if (prevout) {
            const customTx: Transaction = {
                version: DeFiTransactionConstants.Version,
                vin: [{ txid: prevout.txid, index: prevout.vout, script: { stack: [] }, sequence: 0xffffffff }],
                vout: txn.vout,
                lockTime: 0x00000000
            }
            const fee = calculateFeeP2WPKH(new BigNumber(0.00001), customTx)
            customTx.vout[1].value = prevout.value.minus(fee)
            let signed = await this.account?.signTx(customTx, [prevout])
            if (!signed) {
                throw new Error("can't sign custom transaction")
            }
            txn = signed
        }
        return this.send(txn, prevout ? 3000 : 0) //initial wait time when depending on other tx
    }

    protected prevOutFromTx(tx: CTransaction): Prevout {
        return {
            txid: tx.txId,
            vout: 1,
            value: tx.vout[1].value,
            script: tx.vout[1].script,
            tokenId: tx.vout[1].tokenId
        }
    }

    async send(txn: Transaction, initialWaitTime: number = 0): Promise<CTransaction> {
        const ctx = new CTransaction(txn)
        const hex: string = ctx.toHex()

        console.log("Sending txId: " + ctx.txId + " with input: " + ctx.vin[0].txid + ":" + ctx.vin[0].index)
        let start = initialWaitTime
        const waitTime = 10000
        const txId: string = await new Promise((resolve, error) => {
            let intervalID: NodeJS.Timeout
            const sendTransaction = (): void => {
                this.client.rawtx.send({ hex: hex }).then((txId) => {
                    if (intervalID !== undefined) {
                        clearInterval(intervalID)
                    }
                    this.pendingTx = ctx.txId
                    resolve(txId)
                }).catch((e) => {
                    if (start >= waitTime * 5) {
                        if (intervalID !== undefined) {
                            clearInterval(intervalID)
                        }
                        console.log("failed to send tx even after after multiple retries (" + e.error.message + ")")
                        error(e)
                    } else {
                        console.log("error sending tx (" + e.error.message + "). retrying after " + (waitTime / 1000).toFixed(0) + " seconds")
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

    async waitForTx(txId: string, startBlock: number = 0): Promise<boolean> {
        // wait max 10 blocks (otherwise the tx won't get in anymore)
        if (startBlock == 0) {
            startBlock = await this.getBlockHeight()
        }
        let waitingMinutes = 10
        let waitingBlocks = 10
        if (!this.canSign()) { //if can't sign myself: wait till timeout of lambda
            waitingMinutes = 15
            waitingBlocks = 30
        }
        const initialTime = 15000
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
                    if (start >= 60000 * waitingMinutes) { // 10 min timeout
                        console.error(e)
                        if (intervalID !== undefined) {
                            clearInterval(intervalID)
                        }
                        resolve(false)
                    }
                    //also check blockcount
                    this.getBlockHeight().then(block => {
                        if (block > startBlock + waitingBlocks) {
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
                    start += 15000
                    callTransaction()
                }, 15000)
            }, initialTime)
        })
    }
}
