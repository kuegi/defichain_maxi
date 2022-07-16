import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { Telegram } from "../utils/telegram";
import { CommonProgram, ProgramState } from "./common-program";
import { BigNumber } from "@defichain/jellyfish-api-core";
import { IStore } from "../utils/store";
import { WalletSetup } from "../utils/wallet-setup";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { Prevout } from '@defichain/jellyfish-transaction-builder'
import { DONATION_ADDRESS, DONATION_MAX_PERCENTAGE } from "../vault-maxi";


export class LMReinvestProgram extends CommonProgram {
    readonly lmPair: string

    constructor(store: IStore, walletSetup: WalletSetup) {
        super(store, walletSetup)
        this.lmPair = this.settings.LMPair
    }

    async doValidationChecks(telegram: Telegram): Promise<boolean> {
        if (!super.doValidationChecks(telegram)) {
            return false
        }
        if (!this.settings.LMPair.endsWith("-DFI")) {
            const message = "Can only work with DFI pools, not with " + this.settings.LMPair
            await telegram.send(message)
            console.error(message)
            return false
        }
        return true
    }


    async doMaxiChecks(telegram: Telegram,
        pool: PoolPairData | undefined
    ): Promise<boolean> {
        if (!this.doValidationChecks(telegram)) {
            return false
        }
        if (!pool) {
            const message = "No pool found for this token. tried: " + this.lmPair
            await telegram.send(message)
            console.error(message)
            return false
        }
        // sanity check for auto-donate feature, do NOT allow auto-donate above our defined max percentage
        this.settings.autoDonationPercentOfReinvest = Math.min(this.settings.autoDonationPercentOfReinvest, DONATION_MAX_PERCENTAGE)

        return true
    }

    async doAndReportCheck(telegram: Telegram): Promise<boolean> {
        if (!this.doValidationChecks(telegram)) {
            return false //report already send inside
        }

        let walletAddress = await this.getAddress()
        let pool = await this.getPool(this.lmPair)

        let message = "Setup-Check result\n"
            + (walletAddress ? ("in address " + walletAddress) : "no valid address") + "\n"
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

    async checkAndDoReinvest(pool: PoolPairData, balances: Map<String, AddressToken>, telegram: Telegram): Promise<boolean> {
        if (!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
            return false
        }

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
            prevout = this.prevOutFromTx(tx)
        }

        if (amountToUse.gt(this.settings.reinvestThreshold)) {
            let donatedAmount = new BigNumber(0);
            if (this.settings.autoDonationPercentOfReinvest > 0) {
                //send donation and reduce amountToUse
                donatedAmount = amountToUse.times(this.settings.autoDonationPercentOfReinvest).div(100)
                console.log("donating " + donatedAmount.toFixed(2) + " DFI")
                const tx = await this.sendDFIToAccount(donatedAmount, DONATION_ADDRESS, prevout)
                prevout = this.prevOutFromTx(tx)

                amountToUse = amountToUse.minus(donatedAmount)
            }

            const amountToSwap = amountToUse.div(2) //half is swapped to other token
            const tokenA = pool.tokenA
            const tokenB = pool.tokenB
            console.log("swaping " + amountToSwap + " half of (" + amountFromBalance + "+" + fromUtxos + "-" + donatedAmount + ") DFI to " + tokenA.symbol)
            const swap = await this.swap(amountToSwap, +tokenB.id, +tokenA.id, new BigNumber(999999999), prevout)
            if (! await this.waitForTx(swap.txId)) {
                await telegram.send("ERROR: swapping reinvestment failed")
                console.error("swapping reinvestment failed")
                return false
            }

            const updatedPool = await this.getPool(this.lmPair)
            pool = updatedPool!
            const tokens = await this.getTokenBalances()
            const availableA = new BigNumber(tokens.get(tokenA.symbol)?.amount ?? 0)
            let usedAssetB = new BigNumber(tokens.get(tokenB.symbol)?.amount ?? 0)
            let usedAssetA = usedAssetB.multipliedBy(pool.priceRatio.ab)
            if (usedAssetA.gt(availableA)) { //not enough stocks to fill it -> use full stocks and reduce DUSD
                usedAssetA = availableA
                usedAssetB = usedAssetA.multipliedBy(pool.priceRatio.ba)
            }

            console.log(" adding liquidity " + usedAssetA.toFixed(8) + "@" + tokenA.symbol + " " + usedAssetB.toFixed(8) + "@" + tokenB.symbol)

            let addTx = await this.addLiquidity([
                { token: +pool.tokenA.id, amount: usedAssetA },
                { token: +pool.tokenB.id, amount: usedAssetB },
            ], this.prevOutFromTx(swap))

            if (! await this.waitForTx(addTx.txId)) {
                await telegram.send("ERROR: depositing reinvestment failed")
                console.error("depositing failed")
                return false
            } else {
                await telegram.send("reinvested " + amountToUse.toFixed(4) + "@DFI"
                    + " (" + amountFromBalance.toFixed(4) + " DFI tokens, " + fromUtxos.toFixed(4) + " UTXOs, minus " + donatedAmount.toFixed(4) + " donation)"
                    + "\n in " + usedAssetA.toFixed(4) + "@" + tokenA.symbol + " + " + usedAssetB.toFixed(4) + "@" + tokenB.symbol)
                console.log("done ")
                return true
            }

        }

        return false
    }
}
