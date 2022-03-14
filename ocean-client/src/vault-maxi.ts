import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { VaultMaxiProgram, VaultMaxiProgramTransaction } from './programs/vault-maxi-program'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { ProgramState } from './programs/common-program'
import { ProgramStateConverter } from './utils/program-state-converter'
import { nextCollateralRatio } from './utils/helpers'

class SettingsOverride {
    minCollateralRatio: number | undefined
    maxCollateralRatio: number | undefined
    LMToken: string | undefined
}

class maxiEvent {
    overrideSettings: SettingsOverride | undefined
    checkSetup: boolean | undefined
}

export async function main(event: maxiEvent): Promise<Object> {
    let store = new Store()
    let settings = await store.fetchSettings()
    console.log("vault maxi v1.0-beta.2")
    console.log("initial state: "+ProgramStateConverter.toValue(settings.stateInformation))

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

    const telegram = new Telegram(settings, "[Maxi" + settings.paramPostFix + " v1.0b2]")
    const program = new VaultMaxiProgram(store, new WalletSetup(MainNet, settings))
    await program.init()
    
    if(event){
        if (event.checkSetup) {
            let result= await program.doAndReportCheck(telegram)
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
            const result = await program.waitForTx(information.txId)
            console.log(result ? "done" : " timed out -> cleanup")
            if (!result) {
                information.state = ProgramState.Error //force cleanup
            }
        }
        // 2022-03-09 Krysh: only clean up if it is really needed, otherwise we are fine and can proceed like normally
        if (information.state === ProgramState.Error || VaultMaxiProgram.shouldCleanUpBasedOn(information.tx as VaultMaxiProgramTransaction)) {
            console.log("need to clean up")
            result = await program.cleanUp(vault, telegram)
            vault = await program.getVault() as LoanVaultActive
            await telegram.log("executed clean-up part of script " + (result ? "successfull" : "with problems") + ". vault ratio after clean-up " + vault.collateralRatio)
            if(!result) {
                console.error("Error in cleaning up")
                await telegram.send("There was an error in recovering from a failed state. please check yourself!")
            } else {
                console.log("cleanup done")
                await telegram.send("Successfully cleaned up after some error happened")
            }
            //Do not set state to error again, otherwise we risk an endless loop of cleanup-attempts while vault is unmanaged.
            await program.updateToState(ProgramState.Idle, VaultMaxiProgramTransaction.None)
            return { statusCode: result ? 200 : 500 }
        }
    }

    const nextRatio = nextCollateralRatio(vault)
    const usedCollateralRatio= Math.min(+vault.collateralRatio, nextRatio)
    console.log("starting with " + vault.collateralRatio + " (next: "+nextRatio+") in vault, target "
                + settings.minCollateralRatio + " - " + settings.maxCollateralRatio + " token " + settings.LMToken)
    let exposureChanged= false
    //first check for decreaseExposure
    // if no decrease necessary: check for reinvest (as a reinvest would probably trigger an increase exposure, do reinvest first)
    // no reinvest -> check for increase exposure
    if (0 < usedCollateralRatio && usedCollateralRatio < settings.minCollateralRatio) {
        result = await program.decreaseExposure(vault, telegram)
        exposureChanged= true
    } else {
        result = true
        exposureChanged= await program.checkAndDoReinvest(vault, telegram)
        if(!exposureChanged && (usedCollateralRatio < 0 || usedCollateralRatio > settings.maxCollateralRatio)) {
            result = await program.increaseExposure(vault, telegram)
            exposureChanged= true 
        }
    }
    
    if (exposureChanged) {
        const oldRatio = +vault.collateralRatio
        const oldNext = nextRatio
        vault = await program.getVault() as LoanVaultActive
        await telegram.log("executed script " + (result ? "successfully" : "with problems") 
                + ". vault ratio changed from " + oldRatio + " (next " + oldNext + ") to " 
                + vault.collateralRatio + " (next " + nextCollateralRatio(vault) + ")")
    } else {
        await telegram.log("executed script without changes. vault ratio " + vault.collateralRatio + " next " + nextRatio)
    }
    await program.updateToState(result ? ProgramState.Idle : ProgramState.Error, VaultMaxiProgramTransaction.None)
    console.log("wrote state, script done")
    return { statusCode: result ? 200 : 500 }
}
