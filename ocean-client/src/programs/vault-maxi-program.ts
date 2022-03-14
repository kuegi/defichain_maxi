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
import { nextCollateralValue, nextLoanValue } from "../utils/helpers";
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
    private readonly keepWalletClean: boolean
    private readonly sendInOneBlock: boolean = true

    constructor(store: Store, walletSetup: WalletSetup) {
        super(store, walletSetup);

        this.lmPair = this.settings.LMToken + "-DUSD"
        this.targetCollateral = (this.settings.minCollateralRatio + this.settings.maxCollateralRatio) / 200
        this.keepWalletClean = process.env.VAULTMAXI_KEEP_CLEAN !== "false" ?? true
        this.sendInOneBlock = process.env.VAULTMAXI_SEND_IN_1_BLOCK !== "false" ?? true
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
            + "thresholds " + this.settings.minCollateralRatio + " - " + this.settings.maxCollateralRatio + ". loanscheme minimum is " + vaultcheck.loanScheme.minColRatio
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
        if(this.settings.minCollateralRatio > this.settings.maxCollateralRatio-2) {
            const message= "Min collateral must be more than 2 below max collateral. Please change your settings. "
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
        const safetyOverride= process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE ? +(process.env.VAULTMAXI_VAULT_SAFETY_OVERRIDE) : undefined
        const safeCollRatio = safetyOverride ?? +vault.loanScheme.minColRatio * 2
        if(safetyOverride) {
            console.log("using override for vault safety level: "+safetyOverride)
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
            const neededrepay = +vault.loanValue - (+vault.collateralValue * 100 / safeCollRatio)
            const neededStock = neededrepay / (+tokenLoan.activePrice!.active!.amount + (+pool!.priceRatio.ba))
            const neededDusd = neededStock * +pool!.priceRatio.ba
            const neededLPtokens: number = +((await this.getTokenBalance(this.lmPair))?.amount ?? "0")
            if (neededLPtokens > +lpTokens.amount || neededDusd > +dusdLoan.amount || neededStock > +tokenLoan.amount) {
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
        if(!this.doValidationChecks(telegram)) {
            return false //report already send inside
        }
        var values = new CheckedValues()

        let walletAddress = await this.getAddress()
        let vault = await this.getVault()
        let pool = await this.getPool(this.lmPair)

        values.address= walletAddress === this.settings.address ? walletAddress : undefined
        values.vault = (vault?.vaultId === this.settings.vault && vault.ownerAddress == walletAddress) ? vault.vaultId : undefined
        values.minCollateralRatio = this.settings.minCollateralRatio
        values.maxCollateralRatio = this.settings.maxCollateralRatio
        values.LMToken = (pool && pool.symbol == this.lmPair) ? this.settings.LMToken : undefined
        values.reinvest= this.settings.reinvestThreshold

        const message = values.constructMessage()  
                    + "\n" + (this.keepWalletClean ? "trying to keep the wallet clean" : "ignoring dust and commissions")
                    + "\n" + (this.sendInOneBlock ? "sending tx in one block" : "not sending in one block")
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

        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.RemoveLiquidity, removeTx.txId)

        const paybackNextBlock = async (): Promise<boolean> => {
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
                    token.amount = "" + Math.min(+token.amount, wantedusd)
                }
                paybackTokens.push(token)
            }
            token = tokens.get(this.settings.LMToken)
            if (token) {
                if (!this.keepWalletClean) {
                    token.amount = "" + Math.min(+token.amount, neededStock)
                }
                paybackTokens.push(token)
            }

            if (await this.paybackTokenBalances(paybackTokens, telegram)) {
                await telegram.send("done reducing exposure")
                return true
            }
            return false
        }

        if (this.sendInOneBlock) {
            //can't keep wallet clean when sending in one block, because we are not 100% sure if we get the expected tokens from LM pool, 
            // so use the balance as buffer in case of pool change before we remove
            let paybackTokens: AddressToken[] = [
                {
                    id: pool.tokenA.id,
                    amount: "" + neededStock,
                    symbol: pool.tokenA.symbol,
                    displaySymbol: pool.tokenA.displaySymbol,
                    symbolKey: pool.tokenA.symbol,
                    name: pool.tokenA.symbol,
                    isDAT: true,
                    isLPS: false,
                    isLoanToken: true,
                },
                {
                    id: pool.tokenB.id,
                    amount: "" + wantedusd,
                    symbol: pool.tokenB.symbol,
                    displaySymbol: pool.tokenB.displaySymbol,
                    symbolKey: pool.tokenB.symbol,
                    name: pool.tokenB.symbol,
                    isDAT: true,
                    isLPS: false,
                    isLoanToken: true,
                }
            ]
            console.log("paying back loans in same block -> can't use wallet balance")
            //@krysh: not sure if we should do this.
            // trouble: we can't know for sure how much tokens we get out of LM. we assume but don't know. 
            //          if we get a different amount than expected, one balance might be too low and payback fails.
            // worst case: payback tx already got into the mempool but can't be executed -> might not be able to send another one as its double spent. but i think ocean is not that strict
            // question: is all this trouble with error handling and risks worth it to be faster? or better do the safe but slower version for reducing?
            // if the whole thing fails, the next round does a cleanup and everything is good again. but i don't like to rely on clean up on a regular basis
            return await new Promise((resolve) => {
                this.paybackTokenBalances(paybackTokens, telegram, this.prevOutFromTx(removeTx)).then(success => {
                    if (success) {
                        telegram.send("done reducing exposure").then(() => resolve(true))
                    } else {
                        // if we are here, it means the tx got sent, but not confirmed. not sure if that will ever happen. 
                        // likely that such a transaction will already fail the mempool test and therefore never even get into the mempool
                        console.warn("error paying back directly, sending seperatly")
                        paybackNextBlock().then(success => resolve(success))
                    }
                }).catch(e => {
                    // means the tx didn't make it into the mempool, redo token calculations and send again
                    console.warn("error paying back directly, sending seperatly")
                    paybackNextBlock().then(success => resolve(success))
                })
            })

        } else {
            return paybackNextBlock()
        }
    }

    private async paybackTokenBalances(addressTokens: AddressToken[], telegram: Telegram, prevout:Prevout|undefined= undefined): Promise<boolean> {
        let paybackTokens: TokenBalance[] = []
        addressTokens.forEach(addressToken => {
            paybackTokens.push({ token: +addressToken.id, amount: new BigNumber(addressToken.amount) })
        })
        console.log(" paying back tokens " + addressTokens.map(token => " " + token.amount + "@" + token.symbol))
        if (paybackTokens.length > 0) {
            const paybackTx = await this.paybackLoans(paybackTokens,prevout)

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
        const additionalLoan = Math.min((+vault.collateralValue / this.targetCollateral) - +vault.loanValue,
                                (nextCollateralValue(vault) / this.targetCollateral) - nextLoanValue(vault))
        let neededStock = additionalLoan / (+oracle.active!.amount + +pool.priceRatio.ba)
        let neededDUSD = +pool.priceRatio.ba * neededStock

        console.log("increasing by "+additionalLoan+" USD, taking loan " + neededStock + "@" + this.settings.LMToken 
                                                                    + " " + neededDUSD + "@DUSD ")
        const takeLoanTx = await this.takeLoans([
            { token: +pool.tokenA.id, amount: new BigNumber(neededStock) },
            { token: +pool.tokenB.id, amount: new BigNumber(neededDUSD) }
        ])
        await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.TakeLoan, takeLoanTx.txId)
        let addTx:CTransactionSegWit
        if(this.sendInOneBlock){
            let usedDUSD = neededDUSD
            if(this.keepWalletClean) {
                //use full balance to increase exposure: existing balance + expected from loan
                const tokens = await this.getTokenBalances()
                usedDUSD += +(tokens.get("DUSD")?.amount ?? "0") 
                neededStock+= +(tokens.get(this.settings.LMToken)?.amount ?? "0" ) //upper limit for usedStocks
            }
        
            let usedStock = +pool.priceRatio.ab * usedDUSD
            if (usedStock > neededStock) { //not enough stocks to fill it -> use full stocks and reduce DUSD
                usedStock = neededStock
                usedDUSD = +pool.priceRatio.ba * usedStock
            }

            console.log(" adding liquidity in same block " + usedStock + "@" + this.settings.LMToken + " " + usedDUSD + "@DUSD ")
            addTx = await this.addLiquidity([
                { token: +pool.tokenA.id, amount: new BigNumber(usedStock) },
                { token: +pool.tokenB.id, amount: new BigNumber(usedDUSD) },
            ], this.prevOutFromTx(takeLoanTx))
        } else {
            if (!await this.waitForTx(takeLoanTx.txId)) {
                await telegram.send("ERROR: taking loans")
                console.error("taking loans failed")
                return false
            }
            //refresh for latest ratio
            pool = (await this.getPool(this.lmPair))!!
            
            let usedDUSD = neededDUSD
            if(this.keepWalletClean) {
                //use full balance to increase exposure
                const tokens = await this.getTokenBalances()
                usedDUSD = +(tokens.get("DUSD")!.amount)
                neededStock=+(tokens.get(this.settings.LMToken)!.amount) //upper limit for usedStocks
            }
        
            let usedStock = +pool.priceRatio.ab * usedDUSD
            if (usedStock > neededStock) { //not enough stocks to fill it -> use full stocks and reduce DUSD
                usedStock = neededStock
                usedDUSD = +pool.priceRatio.ba * usedStock
            }
            console.log(" adding liquidity " + usedStock + "@" + this.settings.LMToken + " " + usedDUSD + "@DUSD ")
            addTx = await this.addLiquidity([
                { token: +pool.tokenA.id, amount: new BigNumber(usedStock) },
                { token: +pool.tokenB.id, amount: new BigNumber(usedDUSD) },
            ])
        }
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


    async checkAndDoReinvest(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        if(!this.settings.reinvestThreshold || this.settings.reinvestThreshold <= 0) {
            return false
        }

        const utxoBalance= await this.getUTXOBalance()
        const tokenBalance = await this.getTokenBalance("DFI")

        const amountFromBalance= +(tokenBalance?.amount ?? "0")
        const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
        const amountToUse= fromUtxos.plus(amountFromBalance)

        let prevout:Prevout|undefined = undefined
        console.log("checking for reinvest: "+fromUtxos+" from UTXOs, "+amountFromBalance+" tokens. total "+amountToUse+" vs . "+this.settings.reinvestThreshold)
        if(amountToUse.gt(this.settings.reinvestThreshold) && fromUtxos.gt(0)) {
            console.log("converting " + fromUtxos + " UTXOs to token ")
            const tx= await this.utxoToOwnAccount(fromUtxos)
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
            if(this.sendInOneBlock) {
                prevout= this.prevOutFromTx(tx)
                console.log("trying to continue in same block")
            } else {
                if (! await this.waitForTx(tx.txId)) {
                    await telegram.send("ERROR: converting UTXOs failed")
                    console.error("converting UTXOs failed")
                    return false
                } else {
                    console.log("done ")
                }
            }
        }

        if(amountToUse.gt(this.settings.reinvestThreshold)) {
            console.log("depositing "+ amountToUse+" (" + amountFromBalance + "+"+fromUtxos+") DFI to vault ")
            const tx= await this.depositToVault(0,amountToUse,prevout) //DFI is token 0
            await this.updateToState(ProgramState.WaitingForTransaction, VaultMaxiProgramTransaction.Reinvest, tx.txId)
            if (! await this.waitForTx(tx.txId)) {
                await telegram.send("ERROR: depositing reinvestment failed")
                console.error("depositing failed")
                return false
            } else {
                await telegram.send("reinvested "+ amountToUse.toFixed(4)+" (" + amountFromBalance.toFixed(4) + " tokens, "+fromUtxos.toFixed(4)+" UTXOs) DFI")
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

    private prevOutFromTx(tx:CTransactionSegWit):Prevout {
        return {txid: tx.txId,
            vout: 1,
            value: tx.vout[1].value,
            script: tx.vout[1].script,
            tokenId: tx.vout[1].tokenId
        }
    }
}
