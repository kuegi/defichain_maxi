import { LoanVaultActive } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
import { Telegram } from "../utils/telegram";
import { CommonProgram, ProgramState } from "./common-program";
import { BigNumber } from "@defichain/jellyfish-api-core";
import { Store } from "../utils/store";
import { WalletSetup } from "../utils/wallet-setup";
import { AddressToken } from "@defichain/whale-api-client/dist/api/address";
import { TokenBalance } from "@defichain/jellyfish-transaction/dist";

export enum VaultMaxiProgramTransaction {
    None = "none",
    RemoveLiquidity = "removeliquidity",
    PaybackLoan = "paybackloan",
    TakeLoan = "takeloan",
    AddLiquidity = "addliquidity"
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

    async decreaseExposure(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        let pool: PoolPairData = (await this.getPool(this.lmPair))!!
        const oracle: ActivePrice = await this.getFixedIntervalPrice(this.settings.LMToken)
        const neededrepay = Number(vault.loanValue) - (Number(vault.collateralValue) / this.targetCollateral)
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
        console.log("reducing exposure " + wantedusd + "@DUSD " + neededStock + "@" + this.settings.LMToken + " from " + lptokens + " existing LPTokens")
        if (lptokens == 0 || dusdLoan == 0 || tokenLoan == 0) {
            await telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            return false
        }
        const stock_per_token = +pool!.tokenA.reserve / +pool!.totalLiquidity.token
        const removeTokens = Math.min(neededStock / stock_per_token, lptokens)
        await this.updateToState(ProgramState.DoingTransaction, VaultMaxiProgramTransaction.RemoveLiquidity)
        console.log(" would need " + (neededStock / stock_per_token) + " doing " + removeTokens + " ")
        const removeTx = await this.removeLiquidity(+pool!.id, new BigNumber(removeTokens))

        await this.updateToState(ProgramState.WaitingForLastTransaction, VaultMaxiProgramTransaction.RemoveLiquidity)
        if (! await this.waitForTx(removeTx)) {
            await telegram.send("ERROR: when removing liquidity")
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
            await this.updateToState(ProgramState.DoingTransaction, VaultMaxiProgramTransaction.PaybackLoan)
            const paybackTx = await this.paybackLoans(paybackTokens)

            await this.updateToState(ProgramState.WaitingForLastTransaction, VaultMaxiProgramTransaction.PaybackLoan)
            const success = await this.waitForTx(paybackTx)
            if (!success) {
                await telegram.send("ERROR: paying back tokens")
                console.error("ERROR: paying back tokens")
                return false
            } else {
                await telegram.send("done reducing exposure")
                console.log("done")
            }
        } else {
            await telegram.send("ERROR: no tokens to pay back")
            console.error("ERROR: no tokens to pay back")
            return false
        }
        return true
    }

    async increaseExposure(vault: LoanVaultActive, telegram: Telegram): Promise<boolean> {
        console.log(" increasing exposure ")
        let pool: PoolPairData = (await this.getPool(this.lmPair))!!
        const oracle: ActivePrice = await this.getFixedIntervalPrice(this.settings.LMToken)
        const additionalLoan = (+vault.collateralValue / this.targetCollateral) - +vault.loanValue
        let neededStock = additionalLoan / (+oracle.active!.amount + +pool.priceRatio.ba)
        let neededDUSD = +pool.priceRatio.ba * neededStock

        await this.updateToState(ProgramState.DoingTransaction, VaultMaxiProgramTransaction.TakeLoan)
        console.log(" taking loan " + neededStock + "@" + this.settings.LMToken + " " + neededDUSD + "@DUSD ")
        const takeloanTx = await this.takeLoans([
            { token: +pool.tokenA.id, amount: new BigNumber(neededStock) },
            { token: +pool.tokenB.id, amount: new BigNumber(neededDUSD) }
        ])

        await this.updateToState(ProgramState.WaitingForLastTransaction, VaultMaxiProgramTransaction.TakeLoan)
        if (! await this.waitForTx(takeloanTx)) {
            await telegram.send("ERROR: taking loans")
            console.error("ERROR: taking loans")
            return false
        }
        //refresh for latest ratio
        pool = (await this.getPool(this.lmPair))!!
        neededStock = +pool.priceRatio.ab * neededDUSD

        const tokenBalance = await this.getTokenBalance(this.settings.LMToken)
        if (neededStock > +tokenBalance!.amount) {
            neededStock = +tokenBalance!.amount
            neededDUSD = +pool.priceRatio.ba * neededStock
        }

        await this.updateToState(ProgramState.DoingTransaction, VaultMaxiProgramTransaction.AddLiquidity)
        console.log(" adding liquidity " + neededStock + "@" + this.settings.LMToken + " " + neededDUSD + "@DUSD ")
        const addTx = await this.addLiquidity([
            { token: +pool.tokenA.id, amount: new BigNumber(neededStock) },
            { token: +pool.tokenB.id, amount: new BigNumber(neededDUSD) },
        ])

        await this.updateToState(ProgramState.WaitingForLastTransaction, VaultMaxiProgramTransaction.AddLiquidity)
        if (! await this.waitForTx(addTx)) {
            await telegram.send("ERROR: adding liquidity")
            console.error("ERROR: adding liquidity")
            return false
        } else {
            await telegram.send("done increasing exposure")
            console.log("done ")
        }
        return true
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

    async updateToState(state: ProgramState, transaction: VaultMaxiProgramTransaction): Promise<void> {
        return await this.store.updateToState({
            state: state,
            tx: transaction,
            blockHeight: await this.getBlockHeight()
        })
    }
}