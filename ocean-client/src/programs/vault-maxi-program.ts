import { LoanVaultActive, LoanVaultLiquidated, LoanVaultState } from "@defichain/whale-api-client/dist/api/loan";
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
    Reinvest = "reinvest"
}

export class CheckedValues {
    //used addres. only set if wallet initialized and address found
    address: string | undefined
    // monitored vault. only set if vault found
    vault: string | undefined

    minCollateralRatio: number = 0
    maxCollateralRatio: number = -1
    assetA: string | undefined
    assetB: string | undefined
    reinvest: number | undefined

    constructMessage(): string {
        return ""
            + "Setup-Check result\n"
            + (this.vault ? ("monitoring vault " + this.vault) : "no vault found") + "\n"
            + (this.address ? ("from address " + this.address) : "no valid address") + "\n"
            + "Set collateral ratio range " + this.minCollateralRatio + "-" + this.maxCollateralRatio + "\n"
            + (this.assetA ? ("using pool " + this.assetA + "-" + this.assetB) : "no pool found for token ") + "\n"
            + ((this.reinvest && this.reinvest > 0) ? ("Will reinvest above " + this.reinvest + " DFI") : "Will not reinvest")
    }
}

export class VaultMaxiProgram extends CommonProgram {

    private targetCollateral: number
    readonly lmPair: string
    readonly assetA: string
    readonly assetB: string
    private mainCollateralAsset: string
    private isSingleMint: boolean
    private readonly keepWalletClean: boolean

    constructor(store: Store, walletSetup: WalletSetup) {
        super(store, walletSetup);

        this.lmPair = this.settings.LMPair;
        [this.assetA, this.assetB] = this.lmPair.split("-")
        this.mainCollateralAsset = this.settings.mainCollateralAsset
        this.isSingleMint = this.mainCollateralAsset == "DUSD" || this.lmPair == "DUSD-DFI"

        this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200
        this.keepWalletClean = process.env.VAULTMAXI_KEEP_CLEAN !== "false" ?? true
    }

    static shouldCleanUpBasedOn(transaction: VaultMaxiProgramTransaction): boolean {
        return transaction == VaultMaxiProgramTransaction.RemoveLiquidity ||
            transaction == VaultMaxiProgramTransaction.TakeLoan
    }

    targetRatio(): number {
        return this.targetCollateral
    }

    isSingle(): boolean {
        return this.isSingleMint
    }


    async doMaxiChecks(telegram: Telegram,
        vaultcheck: LoanVaultActive | LoanVaultLiquidated,
        pool: PoolPairData | undefined,
        balances: Map<string, AddressToken>
    ): Promise<boolean> {
        if (!super.doValidationChecks(telegram)) {
            return false
        }
        if (!vaultcheck) {
            const message = "Could not find vault. "
                + "trying vault " + this.settings.vault + " in " + this.settings.address + ". "
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
        if(this.assetB != "DUSD" && this.lmPair != "DUSD-DFI") {
            const message = "vaultMaxi only works on dStock-DUSD pools or DUSD-DFI not on " + this.lmPair
            await telegram.send(message)
            console.error(message)
            return false
        }
        if (!pool) {
            const message = "No pool found for this token. tried: " + this.lmPair
            await telegram.send(message)
            console.error(message)
            return false
        }

        // showstoppers checked, now check for warnings or automatic adaptions

        if (+vaultcheck.loanScheme.minColRatio >= this.settings.minCollateralRatio) {
            const message = "minCollateralRatio is too low. "
                + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio
                + ". loanscheme minimum is " + vaultcheck.loanScheme.minColRatio
                + " will use " + (+vaultcheck.loanScheme.minColRatio + 1) + " as minimum"
            await telegram.send(message)
            console.warn(message)
            this.settings.minCollateralRatio = +vaultcheck.loanScheme.minColRatio + 1
        }

        const minRange = 2
        if (this.settings.maxCollateralRatio > 0 && this.settings.minCollateralRatio > this.settings.maxCollateralRatio - minRange) {
            const message = "Min collateral must be more than " + minRange + " below max collateral. Please change your settings. "
                + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio
                + " will use " + this.settings.minCollateralRatio + " - " + (this.settings.minCollateralRatio + minRange)
            await telegram.send(message)
            console.warn(message)
            this.settings.maxCollateralRatio = this.settings.minCollateralRatio + minRange
        }
        this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200

        if(this.mainCollateralAsset != "DUSD" && this.mainCollateralAsset != "DFI") {
            const message = "can't use this main collateral: "+this.mainCollateralAsset+". falling back to DFI"
            await telegram.send(message)
            console.warn(message)
            this.mainCollateralAsset= "DFI"
        }
        if(this.mainCollateralAsset != "DFI" && this.assetB != this.mainCollateralAsset) {
            const message = "can't work with this combination of mainCollateralAsset "+this.mainCollateralAsset+" and lmPair "+this.lmPair
            await telegram.send(message)
            console.warn(message)
            this.mainCollateralAsset = "DFI"
        }
        
        this.isSingleMint = this.mainCollateralAsset == "DUSD" || this.lmPair == "DUSD-DFI"

        const vault = vaultcheck as LoanVaultActive
        if (vault.state != LoanVaultState.FROZEN) {
            //coll ratio checks only done if not frozen (otherwise the ratio might be off)
            //if frozen: its handled outside anyway

            const safetyOverride = process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE ? +(process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE) : undefined
            const safeCollRatio = safetyOverride ?? +vault.loanScheme.minColRatio * 2
            if (safetyOverride) {
                console.log("using override for vault safety level: " + safetyOverride)
            }
            if (+vault.collateralRatio > 0 && +vault.collateralRatio < safeCollRatio) {
                //check if we could provide safety
                const lpTokens = balances.get(this.lmPair)
                const tokenLoan = vault.loanAmounts.find(loan => loan.symbol == this.assetA)
                const dusdLoan = vault.loanAmounts.find(loan => loan.symbol == "DUSD")
                if (!lpTokens || !tokenLoan || (!this.isSingleMint && !dusdLoan)) {
                    const message = "vault ratio not safe but either no lpTokens or no loans in vault.\nDid you change the LMToken? Your vault is NOT safe! "
                    await telegram.send(message)
                    console.warn(message)
                    return true//can still run
                }
                if (!this.isSingleMint) {                    
                    const neededrepay = new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).multipliedBy(100).div(safeCollRatio))
                    const neededStock = neededrepay.div(BigNumber.sum(tokenLoan.activePrice!.active!.amount, pool!.priceRatio.ba))
                    const neededDusd = neededStock.multipliedBy(pool!.priceRatio.ba)
                    const stock_per_token = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
                    const neededLPtokens = neededStock.div(stock_per_token)
                    if (neededLPtokens.gt(lpTokens.amount) || neededDusd.gt(dusdLoan!.amount) || neededStock.gt(tokenLoan.amount)) {
                        const message = "vault ratio not safe but not enough lptokens or loans to be able to guard it.\nDid you change the LMToken? Your vault is NOT safe!\n"
                            + neededLPtokens.toFixed(4) + " vs " + (+lpTokens.amount).toFixed(4) + " " + lpTokens.symbol + "\n"
                            + neededDusd.toFixed(1) + " vs " + (+dusdLoan!.amount).toFixed(1) + " " + dusdLoan!.symbol + "\n"
                            + neededStock.toFixed(4) + " vs " + (+tokenLoan.amount).toFixed(4) + " " + tokenLoan.symbol + "\n"
                        await telegram.send(message)
                        console.warn(message)
                        return true //can still run
                    }
                } else {
                    let oracleA = new BigNumber(1)
                    if (tokenLoan.activePrice) {
                        oracleA = new BigNumber(tokenLoan.activePrice.active?.amount ?? "0")
                    }
                    let oracleB = new BigNumber(0.99) //case DUSD
                    vault.collateralAmounts.forEach(coll => {
                        if (coll.symbol == this.assetB && coll.activePrice?.active != undefined) {
                            oracleB = new BigNumber(coll.activePrice?.active?.amount ?? "0")
                        }
                    })
                    const neededrepay = new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).multipliedBy(100).div(safeCollRatio))
                    const neededLPtokens = neededrepay.times(this.targetCollateral).times(pool.totalLiquidity.token)
                        .div(BigNumber.sum(oracleA.times(pool.tokenA.reserve).times(this.targetCollateral),
                            oracleB.times(pool.tokenB.reserve)))

                    const neededAssetA = neededLPtokens.times(pool.tokenA.reserve).div(pool.totalLiquidity.token)
                    if (neededLPtokens.gt(lpTokens.amount) || neededAssetA.gt(tokenLoan.amount)) {
                        const message = "vault ratio not safe but not enough lptokens or loans to be able to guard it.\nDid you change the LMToken? Your vault is NOT safe!\n"
                            + neededLPtokens.toFixed(4) + " vs " + (+lpTokens.amount).toFixed(4) + " " + lpTokens.symbol + "\n"
                            + neededAssetA.toFixed(4) + " vs " + (+tokenLoan.amount).toFixed(4) + " " + tokenLoan.symbol + "\n"
                        await telegram.send(message)
                        console.warn(message)
                        return true //can still run
                    }
                }
            }
        }
        return true
    }

    async calcSafetyLevel(vault: LoanVaultActive,
        pool: PoolPairData,
        balances: Map<string, AddressToken>): Promise<BigNumber> {
        const lpTokens = balances.get(this.lmPair)
        const assetALoan = vault.loanAmounts.find(loan => loan.symbol == this.assetA)
        const dusdLoan = vault.loanAmounts.find(loan => loan.symbol == "DUSD")
        if (!lpTokens || !assetALoan || (!this.isSingleMint && !dusdLoan)) {
            return new BigNumber(0)
        }
        const assetAPerToken = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
        let usedAssetA = assetAPerToken.multipliedBy(lpTokens.amount)
        if (!this.isSingleMint) {
            const tokenOracle = assetALoan.activePrice?.active?.amount ?? "0"
            let usedDusd = usedAssetA.multipliedBy(pool!.priceRatio.ba)
            if (usedAssetA.gt(assetALoan.amount)) {
                usedAssetA = new BigNumber(assetALoan.amount)
                usedDusd = usedAssetA.multipliedBy(pool!.priceRatio.ba)
            }
            if (usedDusd.gt(dusdLoan!.amount)) {
                usedDusd = new BigNumber(dusdLoan!.amount)
                usedAssetA = usedDusd.multipliedBy(pool!.priceRatio.ab)
            }
            console.log("could pay back up to " + usedDusd + " DUSD and " + usedAssetA + " " + this.assetA)

            return new BigNumber(vault.collateralValue)
                .dividedBy(new BigNumber(vault.loanValue).minus(usedDusd).minus(usedAssetA.multipliedBy(tokenOracle)))
                .multipliedBy(100)
        } else {
            
            let oracleA = new BigNumber(1)
            if (this.assetA != "DUSD") {
                oracleA= new BigNumber(assetALoan.activePrice?.active?.amount ?? "0")
            }
            let oracleB = new BigNumber(0.99) //case DUSD
            vault.collateralAmounts.forEach(coll => {
                if (coll.symbol == this.assetB && coll.activePrice?.active != undefined) {
                    oracleB = new BigNumber(coll.activePrice?.active?.amount ?? "0")
                }
            })            
            let usedLpTokens= new BigNumber(lpTokens.amount)
            if (usedAssetA.gt(assetALoan.amount)) {
                usedAssetA = new BigNumber(assetALoan.amount)
                usedLpTokens = usedAssetA.div(assetAPerToken)
            }
            console.log("could use up to " + usedLpTokens.toFixed(8) + " LP Tokens leading to payback of " + usedAssetA.toFixed(4) + "@" + this.assetA)

            const lpPerTL = usedLpTokens.dividedBy(pool.totalLiquidity.token)
            const maxRatioNum= BigNumber.sum(lpPerTL.times(pool.tokenB.reserve).times(oracleB),vault.collateralValue)
            const maxRatioDenom = new BigNumber(vault.loanValue).minus(lpPerTL.times(pool.tokenA.reserve).times(oracleA))
            return maxRatioNum.div(maxRatioDenom).multipliedBy(100)
        }
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
        
        values.assetA = (pool && pool.symbol == this.lmPair) ? this.assetA : undefined
        values.assetB = values.assetA ? this.assetB : undefined
        if(this.assetB != "DUSD" && this.lmPair != "DUSD-DFI") {
            values.assetA = values.assetB = undefined
        }
        values.reinvest = this.settings.reinvestThreshold

        const message = values.constructMessage()
            + "\n" + (this.keepWalletClean ? "trying to keep the wallet clean" : "ignoring dust and commissions")
            + "\n"+(this.isSingleMint? ("minting only "+ this.assetA) : "minting both assets")
            + "\nmain collateral asset is "+ this.mainCollateralAsset
            + "\nusing ocean at: "+ this.walletSetup.url
            
        console.log(message)
        console.log("using telegram for log: " + telegram.logToken + " chatId: " + telegram.logChatId)
        console.log("using telegram for notification: " + telegram.token + " chatId: " + telegram.chatId)
        await telegram.send(message)
        await telegram.log("log channel active")

        return true
    }

    async decreaseExposure(vault: LoanVaultActive,
        pool: PoolPairData, telegram: Telegram): Promise<boolean> {
        const neededrepay = BigNumber.max(
            new BigNumber(vault.loanValue).minus(new BigNumber(vault.collateralValue).dividedBy(this.targetCollateral)),
            nextLoanValue(vault).minus(nextCollateralValue(vault).div(this.targetCollateral)))
        if (neededrepay.lte(0)) {
            console.error("negative repay, whats happening? loans:" + vault.loanValue + "/" + nextLoanValue(vault)
                + " cols:" + vault.collateralValue + "/" + nextCollateralValue(vault) + " target:" + this.targetCollateral)
            await telegram.send("ERROR: invalid reduce calculation. please check")
            return false
        }
        let tokens = await this.getTokenBalances()
        let assetBLoan: BigNumber = new BigNumber(0)
        let assetALoan: BigNumber = new BigNumber(0)
        vault.loanAmounts.forEach(loanamount => {
            if (loanamount.symbol == this.assetA) {
                assetALoan = new BigNumber(loanamount.amount)
            }
            if (loanamount.symbol == this.assetB) {
                assetBLoan = new BigNumber(loanamount.amount)
            }
        })
        const lptokens: BigNumber = new BigNumber(tokens.get(this.lmPair)?.amount ?? "0")
        if (!this.isSingleMint) {
            const oracle: ActivePrice = await this.getFixedIntervalPrice(this.assetA)
            
            const neededStock = neededrepay.dividedBy(BigNumber.sum(oracle.active!.amount, pool!.priceRatio.ba))
            const wantedusd = neededStock.multipliedBy(pool!.priceRatio.ba)
           
            console.log("reducing exposure by " + neededrepay.toFixed(4) + " USD: " + wantedusd.toFixed(2) + "@DUSD " + neededStock.toFixed(8) + "@" + this.assetA + " from " + lptokens.toFixed(8) + " existing LPTokens")
            if (lptokens.lte(0) || assetBLoan.lte(0) || assetALoan.lte(0)) {
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
            
            let tokens = await this.getTokenBalances()
            console.log(" removed liq. got tokens: " + Array.from(tokens.values()).map(value => " " + value.amount + "@" + value.symbol))

            let paybackTokens: AddressToken[] = []
            let token = tokens.get("DUSD")
            if (token) {
                if (!this.keepWalletClean) {
                    token.amount = "" + BigNumber.min(token.amount, wantedusd)
                }
                paybackTokens.push(token)
            }
            token = tokens.get(this.assetA)
            if (token) {
                if (!this.keepWalletClean) {
                    token.amount = "" + BigNumber.min(token.amount, neededStock)
                }
                paybackTokens.push(token)
            }

            if (await this.paybackTokenBalances(paybackTokens, [], telegram)) {
                await telegram.send("done reducing exposure")
                return true
            }
        } else {
            let oracleA = new BigNumber(1)
            if (this.assetA != "DUSD") {
                const oracle: ActivePrice = await this.getFixedIntervalPrice(this.assetA)
                oracleA = new BigNumber(oracle.active?.amount ?? "0")
            }
            let oracleB = new BigNumber(0.99) //case DUSD
            vault.collateralAmounts.forEach(coll => {
                if (coll.symbol == this.assetB && coll.activePrice?.active != undefined) {
                    oracleB = new BigNumber(coll.activePrice?.active?.amount ?? "0")
                }
            })

            const wantedTokens = neededrepay.times(this.targetCollateral).times(pool.totalLiquidity.token)
                            .div(BigNumber.sum(oracleA.times(pool.tokenA.reserve).times(this.targetCollateral),
                                               oracleB.times(pool.tokenB.reserve)))
            const removeTokens = BigNumber.min(wantedTokens, lptokens)

            const expectedA = removeTokens.times(pool.tokenA.reserve).div(pool.totalLiquidity.token)
            const expectedB = removeTokens.times(pool.tokenB.reserve).div(pool.totalLiquidity.token)

            console.log("reducing exposure by " + neededrepay.toFixed(4) + " USD: " 
                + expectedA.toFixed(4) + "@" + this.assetA + " " + expectedB.toFixed(4) + "@" + this.assetB 
                + " from " + lptokens.toFixed(8) + " existing LPTokens")
            if (lptokens.lte(0) || assetALoan.lte(0)) {
                await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
                console.error("can't withdraw from pool, no tokens left or no loans left")
                return false
            }
            console.log(" would need " + wantedTokens.toFixed(8) + " doing " + removeTokens.toFixed(8) + " ")
            const removeTx = await this.removeLiquidity(+pool!.id, removeTokens)

            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.RemoveLiquidity, removeTx.txId)

            if (! await this.waitForTx(removeTx.txId)) {
                await telegram.send("ERROR: when removing liquidity")
                console.error("removing liquidity failed")
                return false
            }

            let tokens = await this.getTokenBalances()
            console.log(" removed liq. got tokens: " + Array.from(tokens.values()).map(value => " " + value.amount + "@" + value.symbol))

            let paybackTokens: AddressToken[] = []
            let collateralTokens: AddressToken[] = []
            let token = tokens.get(this.assetA)
            if (token) {
                if (!this.keepWalletClean) {
                    token.amount = "" + BigNumber.min(token.amount, expectedA)
                }
                paybackTokens.push(token)
            }

            token = tokens.get(this.assetB)
            if (token) {
                if (!this.keepWalletClean) {
                    token.amount = "" + BigNumber.min(token.amount, expectedB)
                }
                collateralTokens.push(token)
            }

            if (await this.paybackTokenBalances(paybackTokens, collateralTokens, telegram)) {
                await telegram.send("done reducing exposure")
                return true
            }

        }
        return false
    }


    async removeExposure(vault: LoanVaultActive,
        pool: PoolPairData,
        balances: Map<string, AddressToken>,
        telegram: Telegram, silentOnNothingToDo: boolean = false): Promise<boolean> {
        let paybackTokens: AddressToken[] = []
        let collateralTokens: AddressToken[] = []
        const lpTokens = balances.get(this.lmPair)
        const assetALoan = vault.loanAmounts.find(loan => loan.symbol == this.assetA)
        const assetBLoan = vault.loanAmounts.find(loan => loan.symbol == this.assetB)
        const assetAPerToken = new BigNumber(pool!.tokenA.reserve).div(pool!.totalLiquidity.token)
        const assetBPerToken = new BigNumber(pool!.tokenB.reserve).div(pool!.totalLiquidity.token)
        if ((!assetALoan || (!this.isSingleMint && !assetBLoan)) || !lpTokens) { 
            console.info("can't withdraw from pool, no tokens left or no loans left")
            if (!silentOnNothingToDo) {
                await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            }
            return false
        }
        const maxTokenFromAssetA = new BigNumber(assetALoan!.amount).div(assetAPerToken)
        const maxTokenFromAssetB = new BigNumber(assetBLoan?.amount ?? "0").div(assetBPerToken)
        let usedTokens = BigNumber.min(lpTokens.amount, 
                                        maxTokenFromAssetA, 
                                        this.isSingleMint ? maxTokenFromAssetA : maxTokenFromAssetB) //singleMint-> no "restriction" from assetB, can deposit as much as I want
        if (usedTokens.div(0.95).gt(lpTokens.amount)) { // usedtokens > lpTokens * 0.95 
            usedTokens = new BigNumber(lpTokens.amount) //don't leave dust in the LM
        }
        if (usedTokens.lte(0)) {
            console.info("can't withdraw 0 from pool, no tokens left or no loans left")
            if (!silentOnNothingToDo) {
                await telegram.send("ERROR: can't withdraw 0 pool, no tokens left or no loans left")
            }
            return false
        }

        console.log("removing as much exposure as possible: " + usedTokens.toFixed(5) 
        + "tokens. max from "+this.assetB+": " + maxTokenFromAssetB.toFixed(5) 
        + ", max from "+this.assetA+": " + maxTokenFromAssetA.toFixed(5)
        + " max LPtoken available: " + lpTokens.amount)
        const removeTx = await this.removeLiquidity(+pool!.id, usedTokens)

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.RemoveLiquidity, removeTx.txId)

        if (! await this.waitForTx(removeTx.txId)) {
            await telegram.send("ERROR: when removing liquidity")
            console.error("removing liquidity failed")
            return false
        }
        const tokens = await this.getTokenBalances()
        console.log(" removed liq. got tokens: " + Array.from(tokens.values()).map(value => " " + value.amount + "@" + value.symbol))

        let token = tokens.get(this.assetB)
        if (token) {//removing exposure: keep wallet clean
            if (this.isSingleMint) {
                collateralTokens.push(token)
            } else {
                paybackTokens.push(token)
            }
        }
        token = tokens.get(this.assetA)
        if (token) { //removing exposure: keep wallet clean
            paybackTokens.push(token)
        }

        if (await this.paybackTokenBalances(paybackTokens, collateralTokens, telegram)) {
            await telegram.send("done removing exposure")
            return true
        }
        return false
    }

    private async paybackTokenBalances(loanTokens: AddressToken[], collateralTokens: AddressToken[], telegram: Telegram, prevout: Prevout | undefined = undefined): Promise<boolean> {
        
        if(loanTokens.length == 0 && collateralTokens.length == 0) {
            await telegram.send("ERROR: want to pay back, but nothing to do. please check logs")
            console.error("no tokens to pay back or deposit")
            return false
        }
        let waitingTx = undefined
        if (loanTokens.length > 0) {
            console.log(" paying back tokens " + loanTokens.map(token => " " + token.amount + "@" + token.symbol))
            let paybackTokens: TokenBalance[] = []
            loanTokens.forEach(addressToken => {
                paybackTokens.push({ token: +addressToken.id, amount: new BigNumber(addressToken.amount) })
            })
            const paybackTx = await this.paybackLoans(paybackTokens, prevout)
            waitingTx= paybackTx
            prevout= this.prevOutFromTx(paybackTx)
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.PaybackLoan, paybackTx.txId)
        }
        if(collateralTokens.length > 0) {
            console.log(" depositing tokens " + collateralTokens.map(token => " " + token.amount + "@" + token.symbol))
            for(const collToken of collateralTokens) {
                const depositTx= await this.depositToVault(+collToken.id,new BigNumber(collToken.amount),prevout)
                waitingTx= depositTx
                prevout= this.prevOutFromTx(depositTx)
                await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.PaybackLoan, waitingTx.txId)
            }
        }
        
        if (waitingTx != undefined) {
            const success = await this.waitForTx(waitingTx.txId)
            if (!success) {
                await telegram.send("ERROR: paying back tokens")
                console.error("paying back tokens failed")
                return false
            } else {
                console.log("done")
                return true
            }
        } else {
            return false
        }
    }

    async increaseExposure(vault: LoanVaultActive,
        pool: PoolPairData,
        balances: Map<string, AddressToken>, telegram: Telegram): Promise<boolean> {
        console.log("increasing exposure ")
        
        
        const additionalLoan = BigNumber.min(
            new BigNumber(vault.collateralValue).div(this.targetCollateral).minus(vault.loanValue),
            new BigNumber(nextCollateralValue(vault)).div(this.targetCollateral).minus(nextLoanValue(vault)))
       
        if (!this.isSingleMint) {
            const oracleA: ActivePrice = await this.getFixedIntervalPrice(this.assetA)
            if (!oracleA.isLive || +(oracleA.active?.amount ?? "-1") <= 0) {
                console.warn("No active price for token. can't increase exposure")
                await telegram.send("Could not increase exposure, token has currently no active price")
                return false
            }
             let neededStock = additionalLoan.div(BigNumber.sum(oracleA.active!.amount, pool.priceRatio.ba))
            let neededDUSD = neededStock.multipliedBy(pool.priceRatio.ba)

            console.log("increasing by " + additionalLoan + " USD, taking loan " + neededStock + "@" + this.assetA
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
                usedDUSD = usedDUSD.plus(balances.get("DUSD")?.amount ?? "0")
                neededStock = neededStock.plus(balances.get(this.assetA)?.amount ?? "0") //upper limit for usedStocks
            }

            let usedStock = usedDUSD.multipliedBy(pool.priceRatio.ab)
            if (usedStock.gt(neededStock)) { //not enough stocks to fill it -> use full stocks and reduce DUSD
                usedStock = neededStock
                usedDUSD = usedStock.multipliedBy(pool.priceRatio.ba)
            }

            console.log(" adding liquidity in same block " + usedStock.toFixed(8) + "@" + this.assetA + " " + usedDUSD.toFixed(8) + "@DUSD ")
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
                return true
            }
        } else {
           
            let oracleA = new BigNumber(1)
            if (this.assetA != "DUSD") {
                const oracle: ActivePrice = await this.getFixedIntervalPrice(this.assetA)
                if (!oracle.isLive || +(oracle.active?.amount ?? "-1") <= 0) {
                    console.warn("No active price for token. can't increase exposure")
                    await telegram.send("Could not increase exposure, token has currently no active price")
                    return false
                }
                oracleA = new BigNumber(oracle.active?.amount ?? "0")
            }
            let oracleB = new BigNumber(0.99) //case DUSD
            let assetBInColl= "0"
            vault.collateralAmounts.forEach(coll => {
                if (coll.symbol == this.assetB) {
                    if(coll.activePrice?.active != undefined) {
                        oracleB = new BigNumber(coll.activePrice.active.amount)
                    }
                    assetBInColl= coll.amount
                }
            })

            let wantedAssetA = additionalLoan.times(this.targetCollateral)
                        .div(BigNumber.sum(oracleA.times(this.targetCollateral),oracleB.times(pool.priceRatio.ba)))
            let wantedAssetB = wantedAssetA.multipliedBy(pool.priceRatio.ba)
            console.log("increasing by " + additionalLoan + " USD, taking loan " + wantedAssetA.toFixed(4) + "@" + this.assetA
                + ", withdrawing " + wantedAssetB.toFixed(4) + "@"+ this.assetB)
            
            if(!wantedAssetB.lt(assetBInColl)) {
                console.warn("Not enough collateral for single mint. wanted "+wantedAssetB.toFixed(4)+" but got only "+ assetBInColl)
                await telegram.send("Could not increase exposure, not enough "+this.assetB+" in collateral to use: "+wantedAssetB.toFixed(4)+" vs. "+ assetBInColl)
                return false
            }

            const takeLoanTx = await this.takeLoans([
                { token: +pool.tokenA.id, amount: wantedAssetA }
            ])
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.TakeLoan, takeLoanTx.txId)
            //withdraw collateral right away
            const withdrawTx = await this.withdrawFromVault(+pool.tokenB.id, wantedAssetB , this.prevOutFromTx(takeLoanTx))
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.TakeLoan, withdrawTx.txId)
            
            if (this.keepWalletClean) {
                //use full balance to increase exposure: existing balance + expected from loan
                wantedAssetB = wantedAssetB.plus(balances.get(this.assetB)?.amount ?? "0")
                wantedAssetA = wantedAssetA.plus(balances.get(this.assetA)?.amount ?? "0") //upper limit for usedStocks
            }

            let usedAssetB = wantedAssetB
            let usedAssetA = usedAssetB.multipliedBy(pool.priceRatio.ab)
            if (usedAssetA.gt(wantedAssetA)) { //not enough stocks to fill it -> use full stocks and reduce DUSD
                usedAssetA = wantedAssetA
                usedAssetB = usedAssetA.multipliedBy(pool.priceRatio.ba)
            }

            console.log(" adding liquidity in same block " + usedAssetA.toFixed(8) + "@" + this.assetA + " " + usedAssetB.toFixed(8) + "@"+this.assetB)
            const addTx = await this.addLiquidity([
                { token: +pool.tokenA.id, amount: usedAssetA },
                { token: +pool.tokenB.id, amount: usedAssetB },
            ], this.prevOutFromTx(withdrawTx))

            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.AddLiquidity, addTx.txId)
            if (! await this.waitForTx(addTx.txId)) {
                await telegram.send("ERROR: adding liquidity")
                console.error("adding liquidity failed")
                return false
            } else {
                await telegram.send("done increasing exposure")
                console.log("done ")
                return true
            }
        }
        return false
    }

    async sendMotivationalLog(vault: LoanVaultActive, pool: PoolPairData, telegram: Telegram): Promise<void> {
        if (this.targetCollateral > 2.50) {
            return //TODO: send message that user could maximize further?
        }
        const referenceRatio = this.targetCollateral < 1.8 ? 250 : 300
        if (!pool?.apr) {
            //no data, not motivation
            return
        }
        const loanDiff = (+vault.collateralValue) * (1 / this.targetCollateral - 100 / referenceRatio)
        const rewardDiff = loanDiff * pool.apr.total
        if (rewardDiff < 100) {
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


    async checkAndDoReinvest(vault: LoanVaultActive, pool: PoolPairData, balances: Map<String, AddressToken>, telegram: Telegram): Promise<boolean> {
        if (!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
            return false
        }

        const utxoBalance = await this.getUTXOBalance()
        const tokenBalance = balances.get("DFI")

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
            if (this.mainCollateralAsset == "DFI") {
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
                    await this.sendMotivationalLog(vault, pool, telegram)
                    return true
                }
            } else {
                let mainTokenId = 15 //default DUSD
                vault.collateralAmounts.forEach(coll => {
                    if(coll.symbol == this.mainCollateralAsset) {
                        mainTokenId = +coll.id
                    }
                })
                console.log("swaping " + amountToUse + " (" + amountFromBalance + "+" + fromUtxos + ") DFI to "+this.mainCollateralAsset)
                const swap = await this.swap(amountToUse,0,mainTokenId,prevout)
                await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, swap.txId)
                if (! await this.waitForTx(swap.txId)) {
                    await telegram.send("ERROR: swapping reinvestment failed")
                    console.error("swapping reinvestment failed")
                    return false
                } else {                    
                    const tokens = await this.getTokenBalances()
                    const token= tokens.get(this.mainCollateralAsset)
                    let amountToUse= new BigNumber(token!.amount)
                    console.log("depositing " + amountToUse.toFixed(4) + "@"+ this.mainCollateralAsset+" to vault ")
                    const tx = await this.depositToVault(+token!.id, amountToUse)
                    await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
                    if (! await this.waitForTx(tx.txId)) {
                        await telegram.send("ERROR: depositing reinvestment failed")
                        console.error("depositing failed")
                        return false
                    } else {
                        await telegram.send("reinvested " + amountToUse.toFixed(4) + "@"+this.mainCollateralAsset
                        +" ("+ amountFromBalance.toFixed(4) + " DFI tokens, " + fromUtxos.toFixed(4) + " UTXOs)")
                        console.log("done ")
                        await this.sendMotivationalLog(vault, pool, telegram)
                        return true
                    }
                }
            }
        }

        return false
    }

    async cleanUp(vault: LoanVaultActive, balances: Map<string, AddressToken>, telegram: Telegram): Promise<boolean> {
        let wantedTokens: AddressToken[] = []
        let mainAssetAsLoan= false
        vault.loanAmounts.forEach(loan => {
            if(loan.symbol == this.mainCollateralAsset) {
                mainAssetAsLoan= true
            }
            let token = balances.get(loan.symbol)
            if (token) {
                wantedTokens.push(token)
            }
        })
        let collTokens:AddressToken[] = []
        if(this.isSingleMint && !mainAssetAsLoan) { //if there is a loan of the main asset, first pay back the loan
            let token= balances.get(this.mainCollateralAsset)
            if(token) {
                collTokens.push(token)
            }
        }
        if (wantedTokens.length == 0 && collTokens.length == 0) {
            console.log("No tokens to pay back. nothing to clean up")
            return true // not an error
        } else {
            return await this.paybackTokenBalances(wantedTokens, collTokens, telegram)
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
