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
    telegram.token = settings.token
    telegram.chatId = settings.chatId

    const walletSetup = new WalletSetup(MainNet, settings)
    const program = new VaultMaxiProgram(settings, walletSetup)
    await program.init()

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
    console.log("starting with "+collateralRatio+" in vault, target "+settings.minCollateralRatio+" - "+settings.maxCollateralRatio+"")

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
        console.log("reducing exposure "+neededrepay+"@DUSD "+neededStock+"@"+settings.LMToken+" from "+lptokens+" existing LPTokens")
        if(lptokens == 0 || dusdLoan == 0 || tokenLoan == 0) {
            telegram.send("ERROR: can't withdraw from pool, no tokens left or no loans left")
            return {
                statusCode: 500,
                message: "ERROR: can't withdraw from pool, no tokens left or no loans left"
            }
        }
        const stock_per_token = +pool!.tokenA.reserve / +pool!.totalLiquidity.token
        const removeTokens = Math.min(neededStock / stock_per_token, lptokens)
        console.log(" would need "+(neededStock/stock_per_token)+" doing "+removeTokens+" ")
        const removeTx= await program.removeLiquidity(+pool!.id,new BigNumber(removeTokens))
        if(! await program.waitForTx(removeTx)) {
            telegram.send("ERROR: when removing liquidity")
            return {
                statusCode: 500,
                message: "ERROR: when removing liquidity"
            }
        }
        const tokens= await program.getTokenBalances()
        console.log(" removed liq. got tokens: "+tokens+" ")
        let paybackTokens: TokenBalance[] = []
        let token= tokens.get("DUSD")
        if(token) paybackTokens.push({ token: +token.id, amount:new BigNumber(Math.min(+token.amount,neededrepay))})
        token= tokens.get(settings.LMToken)
        if(token) paybackTokens.push({ token: +token.id, amount:new BigNumber(Math.min(+token.amount,neededStock))})
        
        console.log(" paying back tokens "+paybackTokens+"")
        if(paybackTokens.length > 0) {
            const paybackTx= await program.paybackLoans(paybackTokens)
            if(! await program.waitForTx(paybackTx)) {
                telegram.send("ERROR: paying back tokens")
                console.error("ERROR: paying back tokens")
                return {
                    statusCode: 500,
                    message: "ERROR: paying back tokens"
                }
            } else {
                telegram.send("done reducing exposure")
                console.log("done")
            }
        } else {
            telegram.send("ERROR: no tokens to pay back")
            console.error("ERROR: no tokens to pay back")
            return {
                statusCode: 500,
                message: "ERROR: no tokens to pay back"
            }
        }
    } else if(collateralRatio < 0 || collateralRatio > settings.maxCollateralRatio) {

        // increase exposure

        console.log(" increasing exposure ")
        const additionalLoan = (+vault.collateralValue / targetCollateral) - +vault.loanValue
        let neededStock = additionalLoan / (+oracle.active!.amount + +pool.priceRatio.ba)
        let neededDUSD = +pool.priceRatio.ba * neededStock
        
        console.log(" taking loan "+neededStock+"@"+settings.LMToken+" "+neededDUSD+"@DUSD ")
        const takeloanTx= await program.takeLoans([
                            { token: +pool.tokenA.id, amount: new BigNumber(neededStock)},
                            { token:+pool.tokenB.id, amount: new BigNumber(neededDUSD)}
                        ])
        
        if(! await program.waitForTx(takeloanTx)) {
            telegram.send("ERROR: taking loans")
            console.error("ERROR: taking loans")
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
        
        console.log(" adding liquidity "+neededStock+"@"+settings.LMToken+" "+neededDUSD+"@DUSD ")
        const addTx= await program.addLiquidity([
            {token:+pool.tokenA.id, amount:new BigNumber(neededStock)},
            {token:+pool.tokenB.id, amount:new BigNumber(neededDUSD)},
        ])
        if(! await program.waitForTx(addTx)) {
            telegram.send("ERROR: adding liquidity")
            console.error("ERROR: adding liquidity")
            return {
                statusCode: 500,
                message: "ERROR: adding liquidity"
            }
        } else {
            telegram.send("done increasing exposure")
            console.log("done ")
        }
    }

    const response = {
        statusCode: 200
    }
    return response
}