import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { Telegram } from "../utils/telegram";
import { CommonProgram, ProgramState } from "./common-program";
import { BigNumber } from "@defichain/jellyfish-api-core";
import { IStore } from "../utils/store";
import { WalletSetup } from "../utils/wallet-setup";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { Prevout } from '@defichain/jellyfish-transaction-builder'
import { DONATION_ADDRESS, DONATION_MAX_PERCENTAGE } from "../vault-maxi";
import { CTransaction } from "@defichain/jellyfish-transaction/dist";


export enum LMReinvestProgramTransaction {
    None = "none",
    AddLiquidity = "addliquidity",
    Swap = "swap",
}
export class LMReinvestProgram extends CommonProgram {
    readonly lmPair: string

    constructor(store: IStore, walletSetup: WalletSetup) {
        super(store, walletSetup)
        this.lmPair = this.settings.LMPair
    }


    async doMaxiChecks(telegram: Telegram,
        pool: PoolPairData | undefined
    ): Promise<boolean> {
        if (!this.doValidationChecks(telegram, false)) {
            return false
        }
        if (!pool) {
            const message = "No pool found for this token. tried: " + this.lmPair
            await telegram.send(message)
            console.error(message)
            return false
        }
        
        const utxoBalance = await this.getUTXOBalance()
        if( utxoBalance.lte(1e-4)) { //1 tx is roughly 2e-6 fee, one action mainly 3 tx -> 6e-6 fee. we want at least 10 actions safety -> below 1e-4 we warn
            const message= "your UTXO balance is running low in "+this.settings.address+", only "+utxoBalance.toFixed(5)+" DFI left. Please replenish to prevent any errors"
            await telegram.send(message)
            console.warn(message)            
        }

        // sanity check for auto-donate feature, do NOT allow auto-donate above our defined max percentage
        this.settings.autoDonationPercentOfReinvest = Math.min(this.settings.autoDonationPercentOfReinvest, DONATION_MAX_PERCENTAGE)

        return true
    }

    async doAndReportCheck(telegram: Telegram): Promise<boolean> {
        if (!this.doValidationChecks(telegram, false)) {
            return false //report already send inside
        }

        let walletAddress = this.getAddress()
        let pool = await this.getPool(this.lmPair)

        let message = "Setup-Check result:\n"
            + (walletAddress ? ("monitoring address " + walletAddress) : "no valid address") + "\n"
            + (this.canSign() ? ("got valid key: will send tx automatically") : "no valid key, will provide tx for manual signing") + "\n"
            + (pool ? "using pool " : "no pool found for pair ") + this.lmPair + "\n"
            + (this.settings.reinvestThreshold && (this.settings.reinvestThreshold > 0) ? ("Will reinvest above " + (this.settings.reinvestThreshold + " DFI")) : "No reinvest set, got nothing to do!")


        const autoDonationMessage = this.settings.autoDonationPercentOfReinvest > DONATION_MAX_PERCENTAGE
            ? "Thank you for donating " + (DONATION_MAX_PERCENTAGE) + "% of your rewards. You set to donate " + this.settings.autoDonationPercentOfReinvest + "% which is great but feels like an input error. Donation was reduced to " + DONATION_MAX_PERCENTAGE + "% of your reinvest. Feel free to donate more manually"
            : "Thank you for donating " + (this.settings.autoDonationPercentOfReinvest) + "% of your rewards"

        message += "\n" + (this.settings.autoDonationPercentOfReinvest > 0 ? autoDonationMessage : "auto donation is turned off")
            + "\nusing ocean at: " + this.walletSetup.url

        console.log(message)
        console.log("using telegram for log: " + telegram.logToken + " chatId: " + telegram.logChatId)
        console.log("using telegram for notification: " + telegram.token + " chatId: " + telegram.chatId)
        await telegram.send(message)
        await telegram.log("log channel active")

        return true
    }

    async addLiquidityWithFullWallet(pool: PoolPairData,
        balances: Map<String, AddressToken>, telegram: Telegram): Promise<(BigNumber | undefined)[]> {
        const tokenA = pool.tokenA
        const tokenB = pool.tokenB
        const availableA = new BigNumber(balances.get(tokenA.symbol)?.amount ?? 0)
        let usedAssetB = new BigNumber(balances.get(tokenB.symbol)?.amount ?? 0)
        let usedAssetA = usedAssetB.multipliedBy(pool.priceRatio.ab)
        if (usedAssetA.gt(availableA)) { //not enough stocks to fill it -> use full stocks and reduce DUSD
            usedAssetA = availableA
            usedAssetB = usedAssetA.multipliedBy(pool.priceRatio.ba)
        }

        console.log(" adding liquidity " + usedAssetA.toFixed(8) + "@" + tokenA.symbol + " " + usedAssetB.toFixed(8) + "@" + tokenB.symbol)

        let addTx = await this.addLiquidity([
            { token: +pool.tokenA.id, amount: usedAssetA },
            { token: +pool.tokenB.id, amount: usedAssetB },
        ])
        let txsToSign: CTransaction[] = []
        txsToSign.push(addTx)
        if (!this.canSign()) {
            await this.sendTxDataToTelegram(txsToSign, telegram)
            txsToSign = []
        }

        await this.updateToState(ProgramState.WaitingForTransaction,
            LMReinvestProgramTransaction.AddLiquidity, addTx.txId)
        if (! await this.waitForTx(addTx.txId)) {
            await telegram.send("ERROR: depositing reinvestment failed")
            console.error("depositing failed")
            return [undefined, undefined]
        } else {
            return [usedAssetA, usedAssetB]
        }
    }

    async checkAndDoReinvest(pool: PoolPairData, balances: Map<String, AddressToken>, telegram: Telegram): Promise<boolean> {
        if (!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
            return false
        }

        let txsToSign: CTransaction[] = []
        const utxoBalance = await this.getUTXOBalance()
        const tokenBalance = balances.get("DFI")

        const amountFromBalance = new BigNumber(tokenBalance?.amount ?? "0")
        const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
        let amountToUse = fromUtxos.plus(amountFromBalance)

        let prevout: Prevout | undefined = undefined
        console.log("checking for reinvest: " + fromUtxos + " from UTXOs, " + amountFromBalance + " tokens. total " + amountToUse + " vs " + this.settings.reinvestThreshold)
        if (amountToUse.gt(this.settings.reinvestThreshold) && fromUtxos.gt(0)) {
            console.log("converting " + fromUtxos + " UTXOs to token ")
            const tx = await this.utxoToOwnAccount(fromUtxos)
            txsToSign.push(tx)
            prevout = this.prevOutFromTx(tx)
        }

        if (amountToUse.gt(this.settings.reinvestThreshold)) {
            let donatedAmount = new BigNumber(0);
            const maxReinvestForDonation = Math.max(this.settings.reinvestThreshold, 20) * 2 //anything below 20 DFI is considered a "reinvest all the time"            
            if (this.settings.autoDonationPercentOfReinvest > 0 && amountToUse.lt(maxReinvestForDonation)) {
                //send donation and reduce amountToUse
                donatedAmount = amountToUse.times(this.settings.autoDonationPercentOfReinvest).div(100)
                console.log("donating " + donatedAmount.toFixed(2) + " DFI")
                const tx = await this.sendDFIToAccount(donatedAmount, DONATION_ADDRESS, prevout)
                txsToSign.push(tx)
                prevout = this.prevOutFromTx(tx)

                amountToUse = amountToUse.minus(donatedAmount)
            }

            const amountToSwap = amountToUse.div(2) //half is swapped to other token
            const tokenA = pool.tokenA
            const tokenB = pool.tokenB
            console.log("swaping " + amountToSwap + " half of (" + amountFromBalance + "+" + fromUtxos + "-" + donatedAmount + ") DFI to " + tokenA.symbol)
            let swap
            if (+tokenB.id == 0) {
                swap = await this.swap(amountToSwap, 0, +tokenA.id, new BigNumber(999999999), prevout)
                txsToSign.push(swap)
            } else {
                const dusdPool = await this.getPool("DUSD-DFI")
                swap = await this.compositeswap(amountToSwap, 0, +tokenA.id, [{ id: +dusdPool!.id }, { id: +pool.id }], new BigNumber(999999999), prevout)
                txsToSign.push(swap)

                //need to swap both
                console.log("swaping " + amountToSwap + " DFI to " + tokenB.symbol)
                swap = await this.swap(amountToSwap, 0, +tokenB.id, new BigNumber(999999999), this.prevOutFromTx(swap))
                txsToSign.push(swap)
            }
            if (!this.canSign()) {
                await this.sendTxDataToTelegram(txsToSign, telegram)
                txsToSign = []
            }
            await this.updateToState(ProgramState.WaitingForTransaction,
                LMReinvestProgramTransaction.Swap, swap.txId)
            if (!await this.waitForTx(swap.txId)) {
                await telegram.send("ERROR: swapping reinvestment failed")
                console.error("swapping reinvestment failed")
                return false
            }

            const updatedPool = await this.getPool(this.lmPair)
            const tokens = await this.getTokenBalances()
            const [usedAssetA, usedAssetB] = await this.addLiquidityWithFullWallet(updatedPool!, tokens, telegram)
            if (usedAssetA !== undefined && usedAssetB !== undefined) {
                await telegram.send("reinvested " + amountToUse.toFixed(4) + "@DFI"
                    + " (" + amountFromBalance.toFixed(4) + " DFI tokens, " + fromUtxos.toFixed(4) + " UTXOs, minus " + donatedAmount.toFixed(4) + " donation)"
                    + "\n in " + usedAssetA.toFixed(8) + "@" + tokenA.symbol + " paired with " + usedAssetB.toFixed(8) + "@" + tokenB.symbol)
                if (this.settings.autoDonationPercentOfReinvest > 0 && donatedAmount.lte(0)) {
                    await telegram.send("you activated auto donation, but the reinvested amount was too big to be a reinvest. " +
                        "We assume that this was a transfer of funds, so we skipped auto-donation. " +
                        "Feel free to manually donate anyway.")
                }
                console.log("done ")
            }

        }

        return false
    }

    async updateToState(state: ProgramState, transaction: LMReinvestProgramTransaction, txId: string = ""): Promise<void> {
        return await this.store.updateToState({
            state: state,
            tx: transaction,
            txId: txId,
            blockHeight: await this.getBlockHeight(),
            version: "1"
        })
    }
}
