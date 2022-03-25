import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { VaultMaxiProgram, VaultMaxiProgramTransaction } from './programs/vault-maxi-program'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { ProgramState } from './programs/common-program'
import { ProgramStateConverter } from './utils/program-state-converter'
import { isNullOrEmpty, nextCollateralRatio } from './utils/helpers'
import { BigNumber } from "@defichain/jellyfish-api-core";

class SettingsOverride {
    minCollateralRatio: number | undefined
    maxCollateralRatio: number | undefined
    LMToken: string | undefined
}

class maxiEvent {
    overrideSettings: SettingsOverride | undefined
    checkSetup: boolean | undefined
}

const MIN_TIME_PER_ACTION_MS = 300*1000 //min 5 minutes for action. probably only needs 1-2, but safety first?

const VERSION = "v1.0"

export async function main(event: maxiEvent,context: any): Promise<Object> {
    let store = new Store()
    let settings = await store.fetchSettings()
    console.log("vault maxi "+VERSION)
    console.log("initial state: " + ProgramStateConverter.toValue(settings.stateInformation))

    if (event) {
        console.log("received event " + JSON.stringify(event))
        if (event.overrideSettings) {
            if (event.overrideSettings.maxCollateralRatio)
                settings.maxCollateralRatio = event.overrideSettings.maxCollateralRatio
            if (event.overrideSettings.minCollateralRatio)
                settings.minCollateralRatio = event.overrideSettings.minCollateralRatio
            if (event.overrideSettings.LMToken)
                settings.LMToken = event.overrideSettings.LMToken
        }
    }
    const logId = process.env.VAULTMAXI_LOGID ? (" " + process.env.VAULTMAXI_LOGID) : ""
    const telegram = new Telegram(settings, "[Maxi" + settings.paramPostFix+ " "+VERSION+logId+"]")
    try {

        const program = new VaultMaxiProgram(store, new WalletSetup(MainNet, settings))
        await program.init()

        if (event) {
            if (event.checkSetup) {
                let result = await program.doAndReportCheck(telegram)
                return { statusCode: result ? 200 : 500 }
            }
        }

        if (!await program.doValidationChecks(telegram)) {
            return { statusCode: 500 }
        }

        let result = true
        let vault: LoanVaultActive = await program.getVault() as LoanVaultActive //already checked before if all is fine

        //TODO: move that block to function in programm
        // 2022-03-08 Krysh: Something went wrong on last execution, we need to clean up, whatever was done
        if (settings.stateInformation.state !== ProgramState.Idle) {
            const information = settings.stateInformation
            console.log("last execution stopped state " + information.state)
            console.log(" at tx " + information.tx)
            console.log(" with txId " + information.txId)
            console.log(" on block height " + information.blockHeight)

            // 2022-03-09 Krysh: input of kuegi
            // if we are on state waiting for last transaction,  we should wait for txId
            if (information.state === ProgramState.WaitingForTransaction) {
                console.log("waiting for tx from previous run")
                const result = await program.waitForTx(information.txId, information.blockHeight)
                console.log(result ? "done" : " timed out -> cleanup")
                if (!result || VaultMaxiProgram.shouldCleanUpBasedOn(information.tx as VaultMaxiProgramTransaction)) {
                    information.state = ProgramState.Error //force cleanup
                } else {
                    information.state = ProgramState.Idle
                }
                await program.updateToState(information.state, VaultMaxiProgramTransaction.None)
            }
            // 2022-03-09 Krysh: only clean up if it is really needed, otherwise we are fine and can proceed like normally
            if (information.state === ProgramState.Error) {
                console.log("need to clean up")
                result = await program.cleanUp(vault, telegram)
                vault = await program.getVault() as LoanVaultActive
                await telegram.log("executed clean-up part of script " + (result ? "successfull" : "with problems") + ". vault ratio after clean-up " + vault.collateralRatio)
                if (!result) {
                    console.error("Error in cleaning up")
                    await telegram.send("There was an error in recovering from a failed state. please check yourself!")
                } else {
                    console.log("cleanup done")
                    await telegram.send("Successfully cleaned up after some error happened")
                }
                //Do not set state to error again, otherwise we risk an endless loop of cleanup-attempts while vault is unmanaged.
                await program.updateToState(ProgramState.Idle, VaultMaxiProgramTransaction.None)
                console.log("got "+(context.getRemainingTimeInMillis()/1000).toFixed(1)+" sec left after cleanup")
                if(context.getRemainingTimeInMillis() < MIN_TIME_PER_ACTION_MS) { 
                    return { statusCode: result ? 200 : 500 } //not enough time left, better quit and have a clean run on next invocation
                }
                
            }
        }

        const oldRatio = +vault.collateralRatio
        const nextRatio = nextCollateralRatio(vault)
        const usedCollateralRatio = BigNumber.min(vault.collateralRatio, nextRatio)
        console.log("starting with " + vault.collateralRatio + " (next: " + nextRatio + ") in vault, target "
            + settings.minCollateralRatio + " - " + settings.maxCollateralRatio + " token " + settings.LMToken)
        let exposureChanged = false
        //first check for decreaseExposure
        // if no decrease necessary: check for reinvest (as a reinvest would probably trigger an increase exposure, do reinvest first)
        // no reinvest -> check for increase exposure
        if(settings.maxCollateralRatio <= 0) {
            if(usedCollateralRatio.gt(0)) {
                result = await program.removeExposure(vault, telegram)
                exposureChanged = true
                vault= await program.getVault() as LoanVaultActive
            }
        } else if (usedCollateralRatio.gt(0) && usedCollateralRatio.lt(settings.minCollateralRatio)) {
            result = await program.decreaseExposure(vault, telegram)
            exposureChanged = true
            vault= await program.getVault() as LoanVaultActive
        } else {
            result = true
            exposureChanged = await program.checkAndDoReinvest(vault, telegram)
            console.log("got "+(context.getRemainingTimeInMillis()/1000).toFixed(1)+" sec left after reinvest")
            if(exposureChanged){
                vault= await program.getVault() as LoanVaultActive 
            }
            if(context.getRemainingTimeInMillis() > MIN_TIME_PER_ACTION_MS) {// enough time left -> continue
                const usedCollateralRatio = BigNumber.min(+vault.collateralRatio, nextCollateralRatio(vault))
                if (+vault.collateralValue < 10) {
                    const message = "less than 10 dollar in the vault. can't work like that"
                    await telegram.send(message)
                    console.error(message)
                } else if (usedCollateralRatio.lt(0) || usedCollateralRatio.gt(settings.maxCollateralRatio)) {
                    result = await program.increaseExposure(vault, telegram)
                    exposureChanged = true
                }
            }
        }

        await program.updateToState(result ? ProgramState.Idle : ProgramState.Error, VaultMaxiProgramTransaction.None)
        console.log("wrote state")
        if (exposureChanged) {
            await telegram.log("executed script " + (result ? "successfully" : "with problems")
                + ". vault ratio changed from " + oldRatio + " (next " + nextRatio + ") to "
                + vault.collateralRatio + " (next " + nextCollateralRatio(vault) +
                "). target range " + settings.minCollateralRatio + " - " + settings.maxCollateralRatio)
        } else {
            await telegram.log("executed script without changes. vault ratio " + oldRatio + " next " + nextRatio
                + ". target range " + settings.minCollateralRatio + " - " + settings.maxCollateralRatio)
        }
        console.log("script done")
        return { statusCode: result ? 200 : 500 }
    } catch (e) {
        console.error("Error in script")
        console.error(e)
        const message = "There was an unexpected error in the script. please check the logs"
        if (!isNullOrEmpty(telegram.chatId) && !isNullOrEmpty(telegram.token)) {
            await telegram.send(message)
        } else {
            await telegram.log(message)
        }
        //program might not be there, so directly the store with no access to ocean
        await store.updateToState({
            state: ProgramState.Error,
            tx: "",
            txId: "",
            blockHeight: 0
        })
        return { statusCode: 500 }
    }
}
