import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState, LoanVaultTokenAmount } from '@defichain/whale-api-client/dist/api/loan'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { ActivePrice } from '@defichain/whale-api-client/dist/api/prices'
import { VaultMaxiProgram } from './programs/vault-maxi-program'
import { Logger } from './utils/logger'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { BigNumber } from "@defichain/jellyfish-api-core";
import { TokenBalance } from '@defichain/jellyfish-transaction/dist'

export async function main(): Promise<Object> {
    let settings = await new Store().fetchSettings()

    const telegram = new Telegram()
    telegram.logChatId = settings.logChatId
    telegram.logToken = settings.logToken

    Logger.default.setTelegram(telegram)

    const walletSetup = new WalletSetup(MainNet, settings)
    const program = new VaultMaxiProgram(settings, walletSetup)
    await program.init()

    let debug: string= ""
    const targetCollateral = (settings.minCollateralRatio + settings.maxCollateralRatio) / 200
    const lmPair= settings.LMToken + "-DUSD"

    const vaultcheck= await program.getVault()
    if(vaultcheck?.state != LoanVaultState.ACTIVE)
        return {
            statusCode: 500
        }
    
    const vault : LoanVaultActive = vaultcheck
    const collateralRatio = Number(vault.collateralRatio)
    const oracle:ActivePrice = await program.getFixedIntervalPrice(settings.LMToken)
    let pool:PoolPairData = (await program.getPool(lmPair)) !!
    debug += "starting with "+collateralRatio+" in vault, target "+settings.minCollateralRatio+" - "+settings.maxCollateralRatio+"\n"

    if(0 < collateralRatio  && collateralRatio < settings.minCollateralRatio) {
        // reduce exposure
        const neededrepay = Number(vault.loanValue) - (Number(vault.collateralValue) / targetCollateral)
        const neededStock = neededrepay / (+oracle.active!.amount +(+pool!.priceRatio.ba))
        const lptokens:number = +((await program.getTokenBalance(lmPair))?.amount ?? "0")
        let dusdLoan : number = 0
        let tokenLoan : number = 0
        vault.loanAmounts.forEach( loanamount => {
            if(loanamount.symbol == settings.LMToken) {
                tokenLoan= +loanamount.amount
            }
            if(loanamount.symbol == "DUSD") {
                dusdLoan = +loanamount.amount
            }
        })
        debug += "reducing exposure "+neededrepay+" dusd "+neededStock+" dToken from "+lptokens+" existing LPTokens \n"
        if(lptokens == 0 || dusdLoan == 0 || tokenLoan == 0) {
            telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            return {
                statusCode: 500,
                message: "ERROR: can't withdraw from pool, no tokens left or no loans left"
            }
        }
        const stock_per_token = +pool!.tokenA.reserve / +pool!.totalLiquidity.token
        const removeTokens = Math.min(neededStock / stock_per_token, lptokens)
        debug += " would need "+(neededStock/stock_per_token)+" doing "+removeTokens+" \n"
        const removeTx= await program.removeLiquidity(+pool!.id,new BigNumber(removeTokens))
        if(! await program.waitForTx(removeTx)) {
            telegram.send("ERROR: when removing liquidity")
            return {
                statusCode: 500,
                message: "ERROR: when removing liquidity"
            }
        }
        const tokens= await program.getTokenBalances()
        debug += " removed liq. got tokens: "+tokens+" \n"
        let paybackTokens: TokenBalance[] = []
        let token= tokens.get("DUSD")
        if(token) paybackTokens.push({ token: +token.id, amount:new BigNumber(Math.min(+token.amount,neededrepay))})
        token= tokens.get(settings.LMToken)
        if(token) paybackTokens.push({ token: +token.id, amount:new BigNumber(Math.min(+token.amount,neededStock))})
        
        debug += " paying back tokens "+paybackTokens+"\n"
        if(paybackTokens.length > 0) {
            const paybackTx= await program.paybackLoans(paybackTokens)
            if(! await program.waitForTx(paybackTx)) {
                telegram.send("ERROR: paying back tokens")
            } else {
                telegram.send("done reducing exposure")
            }
        } else {
            telegram.send("ERROR: no tokens to pay back")
        }
    } else if(collateralRatio < 0 || collateralRatio > settings.maxCollateralRatio) {

        // increase exposure

        const additionalLoan = (+vault.collateralValue / targetCollateral) - +vault.loanValue
        let neededStock = additionalLoan / (+oracle.active!.amount + +pool.priceRatio.ba)
        let neededDUSD = +pool.priceRatio.ba * neededStock
        const takeloanTx= await program.takeLoans([
                            { token: +pool.tokenA.id, amount: new BigNumber(neededStock)},
                            { token:+pool.tokenB.id, amount: new BigNumber(neededDUSD)}
                        ])
        
        if(! await program.waitForTx(takeloanTx)) {
            telegram.send("ERROR: taking loans")
            return {
                statusCode: 500,
                message: "ERROR: taking loans"
            }
        }
        //refresh for latest ratio
        pool = (await program.getPool(lmPair)) !!
        neededStock = +pool.priceRatio.ab * neededDUSD

        const tokenBalance = await program.getTokenBalance(settings.LMToken)
        if(neededStock > +tokenBalance!.amount) {
            neededStock = +tokenBalance!.amount
            neededDUSD = +pool.priceRatio.ba * neededStock
        }
        const addTx= await program.addLiquidity([
            {token:+pool.tokenA.id, amount:new BigNumber(neededStock)},
            {token:+pool.tokenB.id, amount:new BigNumber(neededDUSD)},
        ])
        if(! await program.waitForTx(addTx)) {
            telegram.send("ERROR: padding liquidity")
        } else {
            telegram.send("done increasing exposure")
        }
    }

    const response = {
        statusCode: 200,
        message: body
    }
    return response
}