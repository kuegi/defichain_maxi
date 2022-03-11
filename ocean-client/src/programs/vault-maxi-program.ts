import { LoanVaultActive, LoanVaultState } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
import { Telegram } from "../utils/telegram";
import { CommonProgram, ProgramState } from "./common-program";
import { BigNumber } from "@defichain/jellyfish-api-core";
import { Store } from "../utils/store";
import { WalletSetup } from "../utils/wallet-setup";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { TokenBalance } from "@defichain/jellyfish-transaction/dist";
import { nextCollateralValue, nextLoanValue } from "../utils/helpers";


export enum VaultMaxiProgramTransaction {
    None = "none",
    RemoveLiquidity = "removeliquidity",
    PaybackLoan = "paybackloan",
    TakeLoan = "takeloan",
    AddLiquidity = "addliquidity",
    Reinvest = "reinvest"
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
        + (this.vault?("monitoring vault "+this.vault):"no vault found") +"\n"
        + (this.address?("from address " + this.address):"no valid address")+"\n"
        + "Set collateral ratio range " + this.minCollateralRatio + "-" + this.maxCollateralRatio + "\n"
        + (this.LMToken ? ("Set dToken "+ this.LMToken ) : "no pool found for token ") +"\n"
        + (this.reinvest ? ("Will reinvest above "+this.reinvest+" DFI"): "Will not reinvest")
    }
}

export class VaultMaxiProgram extends CommonProgram {
    
    private readonly targetCollateral: number
    private readonly lmPair: string

    constructor(store: Store, walletSetup: WalletSetup) {
        super(store, walletSetup);

        this.lmPair = this.settings.LMToken + "-DUSD"
        this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200
    }

    static shouldCleanUpBasedOn(transaction: VaultMaxiProgramTransaction): boolean {
        return transaction == VaultMaxiProgramTransaction.RemoveLiquidity || 
                transaction == VaultMaxiProgramTransaction.TakeLoan
    }

    
    async doValidationChecks(telegram:Telegram) : Promise<boolean> {
        if(!super.doValidationChecks(telegram)) {
            return false
        }
        const vaultcheck = await this.getVault()
        if(!vaultcheck || +vaultcheck.loanScheme.minColRatio >= this.settings.minCollateralRatio) {
            const message= "Could not find vault or minCollateralRatio is too low. "
            + "trying vault " + this.settings.vault + " in " + this.settings.address + ". "
            + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio + ". loanscheme minim is " + vaultcheck.loanScheme.minColRatio
            await telegram.send(message)
            console.error(message)
            return false
        }
        if(vaultcheck.ownerAddress !== this.settings.address) {
            const message= "Error: vault not owned by this address"
            await telegram.send(message)
            console.error(message)
            return false
        }
        if(vaultcheck.state === LoanVaultState.IN_LIQUIDATION) {
            const message= "Error: Can't maximize a vault in liquidation!"
            await telegram.send(message)
            console.error(message)
            return false
        }
        if(this.settings.minCollateralRatio >= this.settings.maxCollateralRatio) {
            const message= "Min collateral must be below max collateral. Please change your settings. "
            + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio
            await telegram.send(message)
            console.error(message)
            return false
        }
        const pool= await this.getPool(this.lmPair)
        if(!pool) {
            const message= "No pool found for this token. tried: "+ this.lmPair
            await telegram.send(message)
            console.error(message)
            return false
        }
        
        const vault= vaultcheck as LoanVaultActive
        if(vault.state == LoanVaultState.FROZEN) {
            const message = "vault is frozen. trying again later "
            await telegram.send(message)
            console.warn(message)
            return false
        }
        if(+vault.collateralValue < 10) {
            const message = "less than 10 dollar in the vault. can't work like that"
            await telegram.send(message)
            console.error(message)
            return false
        }

        // showstoppers checked, now check for warnings

        const safeCollRatio = +vault.loanScheme.minColRatio * 2
        if (+vault.collateralRatio < safeCollRatio) {
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
            const neededrepay = +vault.loanValue - (+vault.collateralValue * 100 / safeCollRatio)
            const neededStock = neededrepay / (+tokenLoan.activePrice!.active!.amount + (+pool!.priceRatio.ba))
            const neededDusd = neededStock * +pool!.priceRatio.ba
            const neededLPtokens: number = +((await this.getTokenBalance(this.lmPair))?.amount ?? "0")
            if (neededLPtokens > +lpTokens.amount || neededDusd > +dusdLoan.amount || neededStock > +tokenLoan.amount) {
                const message = "vault ratio not safe but not enough lptokens or loans to be able to guard it. Did you change the LMToken? Your vault is NOT safe! "
                    + neededLPtokens + " vs " + lpTokens.amount + " " + lpTokens.symbol + "\n"
                    + neededDusd + " vs " + dusdLoan.amount + " " + dusdLoan.symbol + "\n"
                    + neededStock + " vs " + tokenLoan.amount + " " + tokenLoan.symbol + "\n"
                await telegram.send(message)
                console.warn(message)
                return true //can still run
            }
        }
        return true
    }

    async doAndReportCheck(telegram: Telegram): Promise<boolean> {
        if(!this.doValidationChecks(telegram)) {
            return false //report already send inside
        }
        var values = new CheckedValues()

        let walletAddress = await this.getAddress()
        let vault = await this.getVault()
        let pool = await this.getPool(this.lmPair)

        values.address= walletAddress === this.settings.address ? walletAddress : undefined
        values.vault = vault?.vaultId === this.settings.vault && vault.ownerAddress == walletAddress ? vault.vaultId : undefined
        values.minCollateralRatio = this.settings.minCollateralRatio
        values.maxCollateralRatio = this.settings.maxCollateralRatio
        values.LMToken = (pool && pool.symbol == this.lmPair) ? this.settings.LMToken : undefined
        values.reinvest= this.settings.reinvestThreshold

        const message = values.constructMessage()
        console.log(message)
        await telegram.send(message)
        await telegram.log("log channel active")

        return true
    }

    


    async decreaseExposure(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        let pool: PoolPairData = (await this.getPool(this.lmPair))!!
        const oracle: ActivePrice = await this.getFixedIntervalPrice(this.settings.LMToken)
        const neededrepay = Math.max(+vault.loanValue - (+vault.collateralValue / this.targetCollateral),
                                nextLoanValue(vault) - (nextCollateralValue(vault) / this.targetCollateral))
        const neededStock = neededrepay / (+oracle.active!.amount + (+pool!.priceRatio.ba))
        const wantedusd = neededStock * +pool!.priceRatio.ba
        const lptokens: number = +((await this.getTokenBalance(this.lmPair))?.amount ?? "0")
        let dusdLoan: number = 0
        let tokenLoan: number = 0
        vault.loanAmounts.forEach(loanamount => {
            if (loanamount.symbol == this.settings.LMToken) {
                tokenLoan = +loanamount.amount
            }
            if (loanamount.symbol == "DUSD") {
                dusdLoan = +loanamount.amount
            }
        })
        console.log("reducing exposure by "+neededrepay+" USD: " + wantedusd + "@DUSD " + neededStock + "@" + this.settings.LMToken + " from " + lptokens + " existing LPTokens")
        if (lptokens == 0 || dusdLoan == 0 || tokenLoan == 0) {
            await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            console.error("can't withdraw from pool, no tokens left or no loans left")
            return false
        }
        const stock_per_token = +pool!.tokenA.reserve / +pool!.totalLiquidity.token
        const removeTokens = Math.min(neededStock / stock_per_token, lptokens)
        console.log(" would need " + (neededStock / stock_per_token) + " doing " + removeTokens + " ")
        const removeTx = await this.removeLiquidity(+pool!.id, new BigNumber(removeTokens))

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.RemoveLiquidity, removeTx)
        if (! await this.waitForTx(removeTx)) {
            await telegram.send("ERROR: when removing liquidity")
            console.error("removing liquidity failed")
            return false
        }
        const tokens = await this.getTokenBalances()
        console.log(" removed liq. got tokens: " + Array.from(tokens.values()).map(value => " " + value.amount + "@" + value.symbol))
        
        let paybackTokens: AddressToken[] = []
        let token = tokens.get("DUSD")
        if (token) {
            token.amount = "" + Math.min(+token.amount, wantedusd)
            paybackTokens.push(token)
        }
        token = tokens.get(this.settings.LMToken)
        if (token) {
            token.amount = "" + Math.min(+token.amount, neededStock)
            paybackTokens.push(token)
        }

        return await this.paybackTokenBalances(paybackTokens, telegram)
    }

    private async paybackTokenBalances(addressTokens: AddressToken[], telegram: Telegram): Promise<boolean> {
        let paybackTokens: TokenBalance[] = []
        addressTokens.forEach(addressToken => {
            paybackTokens.push({ token: +addressToken.id, amount: new BigNumber(addressToken.amount) })
        })
        console.log(" paying back tokens " + addressTokens.map(token => " " + token.amount + "@" + token.symbol))
        if (paybackTokens.length > 0) {
            const paybackTx = await this.paybackLoans(paybackTokens)

            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.PaybackLoan, paybackTx)
            const success = await this.waitForTx(paybackTx)
            if (!success) {
                await telegram.send("ERROR: paying back tokens")
                console.error("paying back tokens failed")
                return false
            } else {
                await telegram.send("done reducing exposure")
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
        const additionalLoan = Math.min((+vault.collateralValue / this.targetCollateral) - +vault.loanValue,
                                (nextCollateralValue(vault) / this.targetCollateral) - nextLoanValue(vault))
        let neededStock = additionalLoan / (+oracle.active!.amount + +pool.priceRatio.ba)
        let neededDUSD = +pool.priceRatio.ba * neededStock

        console.log("increasing by "+additionalLoan+" USD, taking loan " + neededStock + "@" + this.settings.LMToken + " " + neededDUSD + "@DUSD ")
        const takeloanTx = await this.takeLoans([
            { token: +pool.tokenA.id, amount: new BigNumber(neededStock) },
            { token: +pool.tokenB.id, amount: new BigNumber(neededDUSD) }
        ])

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.TakeLoan, takeloanTx)
        if (! await this.waitForTx(takeloanTx)) {
            await telegram.send("ERROR: taking loans")
            console.error("taking loans failed")
            return false
        }
        //refresh for latest ratio
        pool = (await this.getPool(this.lmPair))!!
        let usedStock = +pool.priceRatio.ab * neededDUSD
        let usedDUSD = neededDUSD
        if (usedStock > neededStock) { //ratio changed, but not enough stocks to fill it -> use full stocks and reduce DUSD
            usedStock = neededStock
            usedDUSD = +pool.priceRatio.ba * usedStock
        }

        console.log(" adding liquidity " + usedStock + "@" + this.settings.LMToken + " " + usedDUSD + "@DUSD ")
        const addTx = await this.addLiquidity([
            { token: +pool.tokenA.id, amount: new BigNumber(usedStock) },
            { token: +pool.tokenB.id, amount: new BigNumber(usedDUSD) },
        ])

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.AddLiquidity, addTx)
        if (! await this.waitForTx(addTx)) {
            await telegram.send("ERROR: adding liquidity")
            console.error("adding liquidity failed")
            return false
        } else {
            await telegram.send("done increasing exposure")
            console.log("done ")
        }
        return true
    }

    async checkAndDoReinvest(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        if(!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
            return false
        }
        
        const tokenBalance = await this.getTokenBalance("DFI")
        if( tokenBalance && +tokenBalance.amount > this.settings.reinvestThreshold) {
            console.log("depositing " + tokenBalance.amount + " DFI to vault ")
            const tx= await this.depositToVault(parseInt(tokenBalance.id),new BigNumber(tokenBalance.amount))
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx)
            if (! await this.waitForTx(tx)) {
                await telegram.send("ERROR: depositing reinvestment failed")
                console.error("depositing failed")
                return false
            } else {
                await telegram.send("reinvested "+tokenBalance.amount+" DFI")
                console.log("done ")
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
        
        return await this.paybackTokenBalances(wantedTokens, telegram)
    }

    async updateToState(state: ProgramState, transaction: VaultMaxiProgramTransaction, txId: string = ""): Promise<void> {
        return await this.store.updateToState({
            state: state,
            tx: transaction,
            txId: txId,
            blockHeight: await this.getBlockHeight()
        })
    }
}
