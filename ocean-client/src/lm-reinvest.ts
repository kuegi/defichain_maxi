import { MainNet } from '@defichain/jellyfish-network'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { CommonProgram, ProgramState } from './programs/common-program'
import { ProgramStateConverter } from './utils/program-state-converter'
import { delay, isNullOrEmpty } from './utils/helpers'
import { BigNumber } from "@defichain/jellyfish-api-core";
import { WhaleClientTimeoutException } from '@defichain/whale-api-client'
import { LMReinvestProgram } from './programs/lm-reinvest-program'
import { StoreAWSReinvest } from './utils/store_aws_reinvest'

class maxiEvent {
    checkSetup: boolean | undefined
}

const MIN_TIME_PER_ACTION_MS = 300 * 1000 //min 5 minutes for action. probably only needs 1-2, but safety first?

export const VERSION = "v1.0.beta"
export const DONATION_ADDRESS = "df1qqtlz4uw9w5s4pupwgucv4shl6atqw7xlz2wn07"
export const DONATION_MAX_PERCENTAGE = 50

export async function main(event: maxiEvent, context: any): Promise<Object> {
    console.log("lm-reinvest " + VERSION)
    let ocean = process.env.VAULTMAXI_OCEAN_URL
    while (context.getRemainingTimeInMillis() >= MIN_TIME_PER_ACTION_MS) {
        console.log("starting with " + context.getRemainingTimeInMillis() + "ms available")
        let store = new StoreAWSReinvest()
        let settings = await store.fetchSettings()

        if (event) {
            console.log("received event " + JSON.stringify(event))
        }
        const logId = process.env.VAULTMAXI_LOGID ? (" " + process.env.VAULTMAXI_LOGID) : ""
        const telegram = new Telegram(settings, "[Reinvest" + settings.paramPostFix + " " + VERSION + logId + "]")

        let commonProgram: CommonProgram | undefined
        try {
            const program = new LMReinvestProgram(store, new WalletSetup(MainNet, settings, ocean))
            commonProgram = program
            await program.init()

            if (event) {
                if (event.checkSetup) {
                    let result = await program.doAndReportCheck(telegram)
                    return { statusCode: result ? 200 : 500 }
                }
            }
            let pool = await program.getPool(program.lmPair)
            if (!await program.doMaxiChecks(telegram, pool)) {
                return { statusCode: 500 }
            }
            let balances = await program.getTokenBalances()
            const DFIinAddress = new BigNumber(balances.get("DFI")?.amount ?? 0)
            let result = true

            console.log("starting with " + DFIinAddress.toFixed(4) + " in address")
            await program.checkAndDoReinvest(pool!, balances, telegram)
            await telegram.log("executed script with " + DFIinAddress.toFixed(4) + " DFI in address")
            console.log("script done ")
            return { statusCode: result ? 200 : 500 }
        } catch (e) {
            console.error("Error in script")
            console.error(e)
            let message = "There was an unexpected error in the script. please check the logs"
            if (e instanceof WhaleClientTimeoutException) {
                message = "There was a timeout from the ocean api. will try again."
                //TODO: do we have to go to error state in this case? or just continue on current state next time?
            }
            if (!isNullOrEmpty(telegram.chatId) && !isNullOrEmpty(telegram.token)) {
                await telegram.send(message)
            } else {
                await telegram.log(message)
            }
            if (ocean != undefined) {
                console.info("falling back to default ocean")
                ocean = undefined
            }
            //program might not be there, so directly the store with no access to ocean
            await store.updateToState({
                state: ProgramState.Error,
                tx: "",
                txId: commonProgram?.pendingTx ?? "",
                blockHeight: 0,
                version: VERSION
            })
            await delay(60000) // cooldown and not to spam telegram
        }
    }
    return { statusCode: 500 } //means we came out of error loop due to not enough time left
}
