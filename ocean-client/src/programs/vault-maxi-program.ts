import { LoanVaultActive, LoanVaultState } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
import { Telegram } from "../utils/telegram";
import { CommonProgram, ProgramState } from "./common-program";
import { BigNumber } from "@defichain/jellyfish-api-core";
import { Store } from "../utils/store";
import { WalletSetup } from "../utils/wallet-setup";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { CTransactionSegWit, TokenBalance, Transaction } from "@defichain/jellyfish-transaction/dist";
import { isNullOrEmpty, nextCollateralValue, nextLoanValue } from "../utils/helpers";
import { Prevout } from '@defichain/jellyfish-transaction-builder/dist/provider'


export enum VaultMaxiProgramTransaction {
    None = "none",
    RemoveLiquidity = "removeliquidity",
    PaybackLoan = "paybackloan",
    TakeLoan = "takeloan",
    AddLiquidity = "addliquidity",
    Reinvest = "reinvest",
    Withdraw = "withdraw"
}

export class CheckedValues {
    //used addres. only set if wallet initialized and address found
    address: string | undefined
    // monitored vault. only set if vault found
    vault: string | undefined

    minCollateralRatio: number = 0
    maxCollateralRatio: number = -1
    LMToken: string | undefined
    reinvest: number | undefined

    constructMessage(): string {
        return ""
            + "Setup-Check result\n"
            + (this.vault ? ("monitoring vault " + this.vault) : "no vault found") + "\n"
            + (this.address ? ("from address " + this.address) : "no valid address") + "\n"
            + "Set collateral ratio range " + this.minCollateralRatio + "-" + this.maxCollateralRatio + "\n"
            + (this.LMToken ? ("Set dToken " + this.LMToken) : "no pool found for token ") + "\n"
            + ((this.reinvest && this.reinvest > 0) ? ("Will reinvest above " + this.reinvest + " DFI") : "Will not reinvest")
    }
}

export class VaultMaxiProgram extends CommonProgram {

    private readonly targetCollateral: number
    private readonly lmPair: string
    private readonly keepWalletClean: boolean

    constructor(store: Store, walletSetup: WalletSetup) {
        super(store, walletSetup);

        this.lmPair = this.settings.LMToken + "-DUSD"
        this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200
        this.keepWalletClean = process.env.VAULTMAXI_KEEP_CLEAN !== "false" ?? true
    }

    static shouldCleanUpBasedOn(transaction: VaultMaxiProgramTransaction): boolean {
        return transaction == VaultMaxiProgramTransaction.RemoveLiquidity ||
            transaction == VaultMaxiProgramTransaction.TakeLoan
    }


    async doValidationChecks(telegram: Telegram): Promise<boolean> {
        if (!super.doValidationChecks(telegram)) {
            return false
        }
        const vaultcheck = await this.getVault()
        if (!vaultcheck || +vaultcheck.loanScheme.minColRatio >= this.settings.minCollateralRatio) {
            const message = "Could not find vault or minCollateralRatio is too low. "
                + "trying vault " + this.settings.vault + " in " + this.settings.address + ". "
                + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio + ". loanscheme minimum is " + vaultcheck.loanScheme.minColRatio
            await telegram.send(message)
            console.error(message)
            return false
        }
        if (vaultcheck.ownerAddress !== this.settings.address) {
            const message = "Error: vault not owned by this address"
            await telegram.send(message)
            console.error(message)
            return false
        }
        if (vaultcheck.state === LoanVaultState.IN_LIQUIDATION) {
            const message = "Error: Can't maximize a vault in liquidation!"
            await telegram.send(message)
            console.error(message)
            return false
        }
        if (this.settings.maxCollateralRatio > 0 && this.settings.minCollateralRatio > this.settings.maxCollateralRatio - 2) {
            const message = "Min collateral must be more than 2 below max collateral. Please change your settings. "
                + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio
            await telegram.send(message)
            console.error(message)
            return false
        }
        const pool = await this.getPool(this.lmPair)
        if (!pool) {
            const message = "No pool found for this token. tried: " + this.lmPair
            await telegram.send(message)
            console.error(message)
            return false
        }

        const vault = vaultcheck as LoanVaultActive
        if (vault.state == LoanVaultState.FROZEN) {
            const message = "vault is frozen. trying again later "
            await telegram.send(message)
            console.warn(message)
            return false
        }

        // showstoppers checked, now check for warnings
        const safetyOverride = process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE ? +(process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE) : undefined
        const safeCollRatio = safetyOverride ?? +vault.loanScheme.minColRatio * 2
        if (safetyOverride) {
            console.log("using override for vault safety level: " + safetyOverride)
        }
        if (+vault.collateralRatio > 0 && +vault.collateralRatio < safeCollRatio) {
            //check if we could provide safety
            const balances = await this.getTokenBalances()
            const lpTokens = balances.get(this.lmPair)
            const tokenLoan = vault.loanAmounts.find(loan => loan.symbol == this.settings.LMToken)
            const dusdLoan = vault.loanAmounts.find(loan => loan.symbol == "DUSD")
            if (!lpTokens || !tokenLoan || !tokenLoan.activePrice?.active || !dusdLoan) {
                const message = "vault ratio not safe but either no lpTokens or no loans in vault. Did you change the LMToken? Your vault is NOT safe! "
                await telegram.send(message)
                console.warn(message)
                return true//can still run
            }
            const neededrepay = new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).multipliedBy(100).div(safeCollRatio))
            const neededStock = neededrepay.div(BigNumber.sum(tokenLoan.activePrice!.active!.amount,pool!.priceRatio.ba))
            const neededDusd = neededStock.multipliedBy(pool!.priceRatio.ba)
            const neededLPtokens = new BigNumber((await this.getTokenBalance(this.lmPair))?.amount ?? "0")
            if (neededLPtokens.gt(lpTokens.amount) || neededDusd.gt(dusdLoan.amount) || neededStock.gt(tokenLoan.amount)) {
                const message = "vault ratio not safe but not enough lptokens or loans to be able to guard it. Did you change the LMToken? Your vault is NOT safe! "
                    + neededLPtokens.toFixed(4) + " vs " + (+lpTokens.amount).toFixed(4) + " " + lpTokens.symbol + "\n"
                    + neededDusd.toFixed(1) + " vs " + (+dusdLoan.amount).toFixed(1) + " " + dusdLoan.symbol + "\n"
                    + neededStock.toFixed(4) + " vs " + (+tokenLoan.amount).toFixed(4) + " " + tokenLoan.symbol + "\n"
                await telegram.send(message)
                console.warn(message)
                return true //can still run
            }
        }
        return true
    }

    async doAndReportCheck(telegram: Telegram): Promise<boolean> {
        if (!this.doValidationChecks(telegram)) {
            return false //report already send inside
        }
        var values = new CheckedValues()

        let walletAddress = await this.getAddress()
        let vault = await this.getVault()
        let pool = await this.getPool(this.lmPair)

        values.address = walletAddress === this.settings.address ? walletAddress : undefined
        values.vault = (vault?.vaultId === this.settings.vault && vault.ownerAddress == walletAddress) ? vault.vaultId : undefined
        values.minCollateralRatio = this.settings.minCollateralRatio
        values.maxCollateralRatio = this.settings.maxCollateralRatio
        values.LMToken = (pool && pool.symbol == this.lmPair) ? this.settings.LMToken : undefined
        values.reinvest = this.settings.reinvestThreshold

        const message = values.constructMessage()
            + "\n" + (this.keepWalletClean ? "trying to keep the wallet clean" : "ignoring dust and commissions")
        console.log(message)
        console.log("using telegram for log: " + telegram.logToken + " chatId: " + telegram.logChatId)
        console.log("using telegram for notification: " + telegram.token + " chatId: " + telegram.chatId)
        await telegram.send(message)
        await telegram.log("log channel active")

        return true
    }

    async decreaseExposure(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        let pool: PoolPairData = (await this.getPool(this.lmPair))!!
        const oracle: ActivePrice = await this.getFixedIntervalPrice(this.settings.LMToken)
        const neededrepay = BigNumber.max(
                    new BigNumber(vault.loanValue).minus( new BigNumber(vault.collateralValue).dividedBy(this.targetCollateral)),
                    nextLoanValue(vault).minus(nextCollateralValue(vault).div(this.targetCollateral)))
        const neededStock = neededrepay.dividedBy(BigNumber.sum(oracle.active!.amount,pool!.priceRatio.ba))
        const wantedusd = neededStock.multipliedBy(pool!.priceRatio.ba)
        const lptokens: BigNumber = new BigNumber((await this.getTokenBalance(this.lmPair))?.amount ?? "0")
        let dusdLoan: BigNumber = new BigNumber(0)
        let tokenLoan: BigNumber = new BigNumber(0)
        vault.loanAmounts.forEach(loanamount => {
            if (loanamount.symbol == this.settings.LMToken) {
                tokenLoan = new BigNumber(loanamount.amount)
            }
            if (loanamount.symbol == "DUSD") {
                dusdLoan = new BigNumber(loanamount.amount)
            }
        })
        console.log("reducing exposure by " + neededrepay.toFixed(4) + " USD: " + wantedusd.toFixed(2) + "@DUSD " + neededStock.toFixed(8) + "@" + this.settings.LMToken + " from " + lptokens.toFixed(8) + " existing LPTokens")
        if (lptokens.lte(0) || dusdLoan.lte(0) || tokenLoan.lte(0)) {
            await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            console.error("can't withdraw from pool, no tokens left or no loans left")
            return false
        }
        const stock_per_token = +pool!.tokenA.reserve / +pool!.totalLiquidity.token
        const removeTokens = BigNumber.min(neededStock.div(stock_per_token), lptokens)
        console.log(" would need " + neededStock.div(stock_per_token).toFixed(8) + " doing " + removeTokens.toFixed(8) + " ")
        const removeTx = await this.removeLiquidity(+pool!.id, removeTokens)

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.RemoveLiquidity, removeTx.txId)

        if (! await this.waitForTx(removeTx.txId)) {
            await telegram.send("ERROR: when removing liquidity")
            console.error("removing liquidity failed")
            return false
        }
        const tokens = await this.getTokenBalances()
        console.log(" removed liq. got tokens: " + Array.from(tokens.values()).map(value => " " + value.amount + "@" + value.symbol))

        let paybackTokens: AddressToken[] = []
        let token = tokens.get("DUSD")
        if (token) {
            if (!this.keepWalletClean) {
                token.amount = "" + BigNumber.min(token.amount, wantedusd)
            }
            paybackTokens.push(token)
        }
        token = tokens.get(this.settings.LMToken)
        if (token) {
            if (!this.keepWalletClean) {
                token.amount = "" + BigNumber.min(token.amount, neededStock)
            }
            paybackTokens.push(token)
        }

        if (await this.paybackTokenBalances(paybackTokens, telegram)) {
            await telegram.send("done reducing exposure")
            return true
        }
        return false
    }

    
    async removeExposure(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        let pool: PoolPairData = (await this.getPool(this.lmPair))!!
        const balances = await this.getTokenBalances()
        const lpTokens = balances.get(this.lmPair)
        const tokenLoan = vault.loanAmounts.find(loan => loan.symbol == this.settings.LMToken)
        const dusdLoan = vault.loanAmounts.find(loan => loan.symbol == "DUSD")
        const stock_per_token = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
        const dusd_per_token = new BigNumber(pool!.tokenB.reserve).div(pool!.totalLiquidity.token)
        if(!tokenLoan || !dusdLoan || !lpTokens ) {
            await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            console.error("can't withdraw from pool, no tokens left or no loans left")
            return false
        }
        const maxTokenFromStock= new BigNumber(tokenLoan!.amount).div(stock_per_token)
        const maxTokenFromDUSD = new BigNumber(dusdLoan!.amount).div(dusd_per_token)
        let usedTokens= BigNumber.min(lpTokens.amount,maxTokenFromDUSD,maxTokenFromStock)
        if(usedTokens.div(0.95).gt(lpTokens.amount)) { // usedtokens > lpTokens * 0.95 
            usedTokens = new BigNumber(lpTokens.amount) //don't leave dust in the LM
        }
        if(usedTokens.lte(0)) {
            await telegram.send("ERROR: can't withdraw 0 pool, no tokens left or no loans left")
            console.error("can't withdraw 0 from pool, no tokens left or no loans left")
            return false
        }

        console.log("removing as much exposure as possible: " + usedTokens.toFixed(5) + "tokens. max from USD: " + maxTokenFromDUSD.toFixed(5) + ", max from dToken: " + maxTokenFromStock.toFixed(5) + " max LPtoken available: " + lpTokens.amount)
        const removeTx = await this.removeLiquidity(+pool!.id, usedTokens)

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.RemoveLiquidity, removeTx.txId)

        if (! await this.waitForTx(removeTx.txId)) {
            await telegram.send("ERROR: when removing liquidity")
            console.error("removing liquidity failed")
            return false
        }
        const tokens = await this.getTokenBalances()
        console.log(" removed liq. got tokens: " + Array.from(tokens.values()).map(value => " " + value.amount + "@" + value.symbol))

        let paybackTokens: AddressToken[] = []
        let token = tokens.get("DUSD")
        if (token) {//reducing exposure: keep wallet clean
            paybackTokens.push(token)
        }
        token = tokens.get(this.settings.LMToken)
        if (token) { //reducing exposure: keep wallet clean
            paybackTokens.push(token)
        }

        if (await this.paybackTokenBalances(paybackTokens, telegram)) {
            await telegram.send("done removing exposure")
            return true
        }
        return false
    }

    private async paybackTokenBalances(addressTokens: AddressToken[], telegram: Telegram, prevout: Prevout | undefined = undefined): Promise<boolean> {
        let paybackTokens: TokenBalance[] = []
        addressTokens.forEach(addressToken => {
            paybackTokens.push({ token: +addressToken.id, amount: new BigNumber(addressToken.amount) })
        })
        console.log(" paying back tokens " + addressTokens.map(token => " " + token.amount + "@" + token.symbol))
        if (paybackTokens.length > 0) {
            const paybackTx = await this.paybackLoans(paybackTokens, prevout)

            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.PaybackLoan, paybackTx.txId)
            const success = await this.waitForTx(paybackTx.txId)
            if (!success) {
                await telegram.send("ERROR: paying back tokens")
                console.error("paying back tokens failed")
                return false
            } else {
                console.log("done")
            }
        } else {
            await telegram.send("ERROR: no tokens to pay back")
            console.error("no tokens to pay back")
            return false
        }
        return true
    }

    async increaseExposure(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        console.log("increasing exposure ")
        let pool: PoolPairData = (await this.getPool(this.lmPair))!!
        const oracle: ActivePrice = await this.getFixedIntervalPrice(this.settings.LMToken)
        const additionalLoan = BigNumber.min(
                new BigNumber(vault.collateralValue).div(this.targetCollateral).minus(vault.loanValue),
                new BigNumber(nextCollateralValue(vault)).div(this.targetCollateral).minus(nextLoanValue(vault)))
        let neededStock =  additionalLoan.div(BigNumber.sum(oracle.active!.amount,pool.priceRatio.ba))
        let neededDUSD = neededStock.multipliedBy(pool.priceRatio.ba)

        console.log("increasing by " + additionalLoan + " USD, taking loan " + neededStock + "@" + this.settings.LMToken
            + " " + neededDUSD + "@DUSD ")
        const takeLoanTx = await this.takeLoans([
            { token: +pool.tokenA.id, amount: neededStock },
            { token: +pool.tokenB.id, amount: neededDUSD }
        ])
        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.TakeLoan, takeLoanTx.txId)
        let addTx: CTransactionSegWit
        let usedDUSD = neededDUSD
        if (this.keepWalletClean) {
            //use full balance to increase exposure: existing balance + expected from loan
            const tokens = await this.getTokenBalances()
            usedDUSD = usedDUSD.plus(tokens.get("DUSD")?.amount ?? "0")
            neededStock = neededStock.plus(tokens.get(this.settings.LMToken)?.amount ?? "0") //upper limit for usedStocks
        }

        let usedStock = usedDUSD.multipliedBy(pool.priceRatio.ab)
        if (usedStock.gt(neededStock)) { //not enough stocks to fill it -> use full stocks and reduce DUSD
            usedStock = neededStock
            usedDUSD = usedStock.multipliedBy(pool.priceRatio.ba)
        }

        console.log(" adding liquidity in same block " + usedStock + "@" + this.settings.LMToken + " " + usedDUSD + "@DUSD ")
        addTx = await this.addLiquidity([
            { token: +pool.tokenA.id, amount: usedStock },
            { token: +pool.tokenB.id, amount: usedDUSD },
        ], this.prevOutFromTx(takeLoanTx))

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.AddLiquidity, addTx.txId)
        if (! await this.waitForTx(addTx.txId)) {
            await telegram.send("ERROR: adding liquidity")
            console.error("adding liquidity failed")
            return false
        } else {
            await telegram.send("done increasing exposure")
            console.log("done ")
        }
        return true
    }

    async sendMotivationalLog(telegram: Telegram): Promise<void> {
        if (this.targetCollateral > 2.50) {
            return //TODO: send message that user could maximize further?
        }
        const referenceRatio = this.targetCollateral < 1.8 ? 250 : 300
        const pool: PoolPairData | undefined = await this.getPool(this.lmPair)
        if (!pool?.apr) {
            //no data, not motivation
            return
        }
        const vault = await this.getVault() as LoanVaultActive
        const loanDiff = (+vault.collateralValue) * (1 / this.targetCollateral - 100 / referenceRatio)
        const rewardDiff = loanDiff * pool.apr.total
        if(rewardDiff < 100) {
            return //just a testvault, no need to motivate anyone
        }
        let rewardMessage: string
        if (rewardDiff > 100 * 365) {
            rewardMessage = "$" + (rewardDiff / 365).toFixed(0) + " in rewards per day"
        } else if (rewardDiff > 100 * 52) {
            rewardMessage = "$" + (rewardDiff / 52).toFixed(0) + " in rewards per week"
        } else if (rewardDiff > 100 * 12) {
            rewardMessage = "$" + (rewardDiff / 12).toFixed(0) + " in rewards per month"
        } else {
            rewardMessage = "$" + (rewardDiff).toFixed(0) + " in rewards per year"
        }
        const message = "With VaultMaxi you currently earn additional " + rewardMessage + " (compared to using " + referenceRatio + "% collateral ratio).\n"
            + "You are very welcome.\nDonations are always appreciated!"
        if (!isNullOrEmpty(telegram.chatId) && !isNullOrEmpty(telegram.token)) {
            await telegram.send(message)
        } else {
            await telegram.log(message)
        }
    }

    async moveTo(telegram: Telegram): Promise<boolean> {
        if(!this.settings.moveToTreshold || this.settings.moveToTreshold <=0) {
            return false
        }

        const utxoBalance = await this.getUTXOBalance()
        const tokenBalance = await this.getTokenBalance("DFI")

        const amountFromBalance = new BigNumber(tokenBalance?.amount ?? "0")
        const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
        const amountToUse = fromUtxos.plus(amountFromBalance)

        let prevout: Prevout | undefined = undefined
        console.log("checking for moving DFI: " + fromUtxos + " from UTXOs, " + amountFromBalance + " token. total " + amountToUse + " vs " + this.settings.moveToTreshold)
        // need to switch Token to UTXO
        if(amountToUse.gt(this.settings.moveToTreshold) && amountFromBalance.gt(0)) {
            const tx = await this.tokenToUtxo(amountFromBalance)
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Withdraw, tx.txId)
            prevout = this.prevOutFromTx(tx)
            const newtx = await this.withdraw(amountToUse,prevout)
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Withdraw, newtx.txId)
            if(! await this.waitForTx(newtx.txId)) {
                await telegram.send("ERROR: withdraw: " + amountToUse+ "DFI to: " + this.settings.moveToAddress + " !")
                console.log("withdraw failed")
                return false
            } else {
                await telegram.send("Withdraw: " + amountToUse + "DFI to: " + this.settings.moveToAddress + " done")
                console.log("withdraw down")
                return true
            }
        }

        return false
    }


    async checkAndDoReinvest(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        if (!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
            return false
        }

        const utxoBalance = await this.getUTXOBalance()
        const tokenBalance = await this.getTokenBalance("DFI")

        const amountFromBalance = new BigNumber(tokenBalance?.amount ?? "0")
        const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
        const amountToUse = fromUtxos.plus(amountFromBalance)

        let prevout: Prevout | undefined = undefined
        console.log("checking for reinvest: " + fromUtxos + " from UTXOs, " + amountFromBalance + " tokens. total " + amountToUse + " vs " + this.settings.reinvestThreshold)
        if (amountToUse.gt(this.settings.reinvestThreshold) && fromUtxos.gt(0)) {
            console.log("converting " + fromUtxos + " UTXOs to token ")
            const tx = await this.utxoToOwnAccount(fromUtxos)
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
            prevout = this.prevOutFromTx(tx)
        }

        if (amountToUse.gt(this.settings.reinvestThreshold)) {
            console.log("depositing " + amountToUse + " (" + amountFromBalance + "+" + fromUtxos + ") DFI to vault ")
            const tx = await this.depositToVault(0, amountToUse, prevout) //DFI is token 0
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
            if (! await this.waitForTx(tx.txId)) {
                await telegram.send("ERROR: depositing reinvestment failed")
                console.error("depositing failed")
                return false
            } else {
                await telegram.send("reinvested " + amountToUse.toFixed(4) + " (" + amountFromBalance.toFixed(4) + " tokens, " + fromUtxos.toFixed(4) + " UTXOs) DFI")
                console.log("done ")
                await this.sendMotivationalLog(telegram)
                return true
            }
        }

        return false
    }

    async cleanUp(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        const tokens = await this.getTokenBalances()
        let wantedTokens: AddressToken[] = []
        vault.loanAmounts.forEach(loan => {
            let token = tokens.get(loan.symbol)
            if (token) {
                wantedTokens.push(token)
            }
        })
        if(wantedTokens.length == 0) {
            console.log("No tokens to pay back. nothing to clean up")
            return true // not an error
        } else {
            return await this.paybackTokenBalances(wantedTokens, telegram)
        }
    }

    async updateToState(state: ProgramState, transaction: VaultMaxiProgramTransaction, txId: string = ""): Promise<void> {
        return await this.store.updateToState({
            state: state,
            tx: transaction,
            txId: txId,
            blockHeight: await this.getBlockHeight()
        })
    }

    private prevOutFromTx(tx: CTransactionSegWit): Prevout {
        return {
            txid: tx.txId,
            vout: 1,
            value: tx.vout[1].value,
            script: tx.vout[1].script,
            tokenId: tx.vout[1].tokenId
        }
    }
}
