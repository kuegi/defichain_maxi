import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { VaultMaxiProgram, VaultMaxiProgramTransaction } from './programs/vault-maxi-program'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { CheckProgram } from './programs/check-program'
import { ProgramState } from './programs/common-program'

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
    console.log("vault maxi v1.0-beta.1")
    const telegram = new Telegram(settings, "[Maxi" + settings.paramPostFix + " " + (settings.vault?.length > 6 ? settings.vault.substring(0, 6) : "...") + "]")
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

        if (event.checkSetup) {
            if (CheckProgram.canDoCheck(settings)) {
                const program = new CheckProgram(store, new WalletSetup(MainNet, settings))
                await program.init()
                await program.reportCheck(telegram)
                return { statusCode: 200 }
            } else {
                const message = CheckProgram.buildCurrentSettingsIntoMessage(settings)
                console.log(message)
                await telegram.log(message)
                await telegram.send(message)
                return {
                    statusCode: 500,
                    message: message
                }
            }
        }
    }

    const program = new VaultMaxiProgram(store, new WalletSetup(MainNet, settings))
    await program.init()
    if (! await program.isValid()) {
        await telegram.send("Configuration error. please check your values")
        return {
            statusCode: 500
        }
    }

    const vaultcheck = await program.getVault()
    if(!vaultcheck) {
        console.error("Did not find vault")
        await telegram.send("Error: vault is gone ")
        return {
            statusCode: 500
        }
    }
    if (vaultcheck.state == LoanVaultState.FROZEN || vaultcheck.state == LoanVaultState.IN_LIQUIDATION) {
        await telegram.send("Error: vault not active, its " + vaultcheck.state)
        console.error("Vault not active: "+vaultcheck.state)
        return {
            statusCode: 500
        }
    }

    let vault: LoanVaultActive = vaultcheck
    if(+vault.collateralValue < 10) {
        await telegram.send("less than 10 dollar in the vault, can't work with that")
        console.error("less than 10 dollar in the vault. can't work like that")
        return {statusCode:500}
    }
    let result = true

    // 2022-03-08 Krysh: Something went wrong on last execution, we need to clean up, whatever was done
    if (settings.stateInformation && settings.stateInformation.state !== ProgramState.Idle) {
        const information = settings.stateInformation
        console.log("last execution stopped state " + information.state)
        console.log(" for tx " + information.tx)
        console.log(" for txId " + information.txId)
        console.log(" on block height " + information.blockHeight)

        let shouldCleanUp = false

        // 2022-03-09 Krysh: input of kuegi
        // if we are on state waiting for last transaction and we are still on same block height since last execution
        // then we should wait for txId
        const currentBlockHeight = await program.getBlockHeight()
        if (information.state === ProgramState.WaitingForTransaction && information.blockHeight === currentBlockHeight) {
            console.log("waiting for tx from previous run")
            await program.waitForTx(information.txId)
        }
        // 2022-03-09 Krysh: only clean up if it is really needed, otherwise we are fine and can proceed like normally
        if (information.state === ProgramState.Error || VaultMaxiProgram.shouldCleanUpBasedOn(information.tx as VaultMaxiProgramTransaction)) {
            console.log("need to clean up")
            result = await program.cleanUp(vault, telegram)
            const cleanUpVaultCheck = await program.getVault() as LoanVaultActive
            await telegram.log("executed clean-up part of script " + (result ? "successfull" : "with problems") + ". vault ratio after clean-up " + cleanUpVaultCheck.collateralRatio)
            if(!result) {
                console.error("Error in cleaning up")
                await telegram.send("There was an error in recovering from a failed state. please check yourself!")
            } else {
                console.log("cleanup done")
                await telegram.send("Successfully cleaned up after some error happened")
            }
            //Do not set state to error again, otherwise we risk an endless loop of cleanup-attempts while vault is unmanaged.
            await program.updateToState(ProgramState.Idle, VaultMaxiProgramTransaction.None)
            return {
                statusCode: result ? 200 : 500
            }
        }
    }

    const nextCollateralRatio = program.nextCollateralRatio(vault)
    const usedCollateralRatio= Math.min(+vault.collateralRatio, nextCollateralRatio)
    console.log("starting with " + vault.collateralRatio + " (next: "+nextCollateralRatio+") in vault, target " + settings.minCollateralRatio + " - " + settings.maxCollateralRatio + " token " + settings.LMToken)
    let exposureChanged= false
    if (0 < usedCollateralRatio && usedCollateralRatio < settings.minCollateralRatio) {
        result = await program.decreaseExposure(vault, telegram)
        exposureChanged= true
    } else if (usedCollateralRatio < 0 || usedCollateralRatio > settings.maxCollateralRatio) {
        result = await program.increaseExposure(vault, telegram)
        exposureChanged= true
    } else {
        result = true
        exposureChanged= await program.checkAndDoReinvest(vault, telegram)
    }
    
    if (exposureChanged) {
        const oldRatio = +vault.collateralRatio
        const oldNext = nextCollateralRatio
        vault = await program.getVault() as LoanVaultActive
        await telegram.log("executed script " + (result ? "successfully" : "with problems") 
                + ". vault ratio changed from " + oldRatio + " (next " + oldNext + ") to " 
                + vault.collateralRatio + " (next " + program.nextCollateralRatio(vault) + ")")
    } else {
        await telegram.log("executed script without changes. vault ratio " 
                + vault.collateralRatio + " next " + program.nextCollateralRatio(vault))
    }
    await program.updateToState(result ? ProgramState.Idle : ProgramState.Error, VaultMaxiProgramTransaction.None)
    return {
        statusCode: result ? 200 : 500
    }
}
