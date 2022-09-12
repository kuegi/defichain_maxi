import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { VaultMaxiProgram, VaultMaxiProgramTransaction } from './programs/vault-maxi-program'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { CommonProgram, ProgramState } from './programs/common-program'
import { ProgramStateConverter } from './utils/program-state-converter'
import { delay, isNullOrEmpty } from './utils/helpers'
import { BigNumber } from "@defichain/jellyfish-api-core";
import { WhaleClientTimeoutException } from '@defichain/whale-api-client'
import { StoreAWSTestnetBot } from './utils/store_aws_testnetbot'
import { TestnetBotProgram } from './programs/testnetbot-program'


class botEvent {
    checkSetup: boolean | undefined
}

const MIN_TIME_PER_ACTION_MS = 300 * 1000 //min 5 minutes for action. probably only needs 1-2, but safety first?

export const VERSION = "v1.0"

export async function main(event: botEvent, context: any): Promise<Object> {
    console.log("testnetBot " + VERSION)
    let blockHeight = 0
    let ocean = process.env.VAULTMAXI_OCEAN_URL
    let errorCooldown = 60000
    while (context.getRemainingTimeInMillis() >= MIN_TIME_PER_ACTION_MS) {
        console.log("starting with " + context.getRemainingTimeInMillis() + "ms available")
        let store = new StoreAWSTestnetBot()
        let settings = await store.fetchSettings()

        const telegram = new Telegram(settings, "[Testbot " + VERSION + "]")
        try {
            if (event) {
                console.log("received event " + JSON.stringify(event))
            }
            const program = new TestnetBotProgram(store, new WalletSetup(settings, ocean))
            await program.init()
            if (!program.isTestNet()) {
                console.error("Must only run on testnet!")
                return { statusCode: 500 }
            }
            blockHeight = await program.getBlockHeight()
            console.log("starting at block " + blockHeight)
            if (event) {
                if (event.checkSetup) {
                    let result = await program.doAndReportCheck(telegram)
                    return { statusCode: result ? 200 : 500 }
                }
            }

            await program.checkAndDoArbitrage(telegram)

            console.log("script done ")
            return { statusCode: 200 }
        } catch (e) {
            console.error("Error in script")
            console.error(e)
            let message = "There was an unexpected error in the script. please check the logs"
            if (e instanceof SyntaxError) {
                console.info("syntaxError: '" + e.name + "' message: " + e.message)
                if (e.message == "Unexpected token < in JSON at position 0") {
                    message = "There was a error from the ocean api. will try again."
                }
                //TODO: do we have to go to error state in this case? or just continue on current state next time?
            }
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
            await delay(errorCooldown) // cooldown and not to spam telegram
            errorCooldown += 60000 //increase cooldown. if error is serious -> less spam in telegram
        }
    }
    return { statusCode: 500 } //means we came out of error loop due to not enough time left
}
