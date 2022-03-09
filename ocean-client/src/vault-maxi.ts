import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { VaultMaxiProgram, VaultMaxiProgramTransaction } from './programs/vault-maxi-program'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { CheckProgram } from './programs/check-program'
import { ProgramState } from './programs/common-program'
import { NONAME } from 'dns'


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
    if (vaultcheck?.state != LoanVaultState.ACTIVE) {
        await telegram.send("Error: vault not active, its " + vaultcheck.state)
        return {
            statusCode: 500
        }
    }

    let vault: LoanVaultActive = vaultcheck
    let result = true

    // 2022-03-08 Krysh: Something went wrong on last execution, we need to clean up, whatever was done
    if (settings.stateInformation && settings.stateInformation.state !== ProgramState.Waiting) {
        const information = settings.stateInformation
        console.log("last execution stopped state " + information.state)
        console.log(" for tx " + information.tx)
        console.log(" on block height " + information.blockHeight)

        let shouldCleanUp = false

        // 2022-03-09 Krysh: input of kuegi
        // if we are on state waiting for last transaction and we are still on same block height since last execution
        // then we should wait for next block
        const currentBlockHeight = await program.getBlockHeight()
        if (information.state === ProgramState.WaitingForLastTransaction && information.blockHeight === currentBlockHeight) {
            console.log("waiting for next block")
            await program.waitForBlockAfter(currentBlockHeight)
        }
        // 2022-03-09 Krysh: only clean up if it is really needed, otherwise we are fine and can proceed like normally
        if (VaultMaxiProgram.shouldCleanUpBasedOn(information.tx as VaultMaxiProgramTransaction)) {
            console.log("need to clean up")
            result = await program.cleanUp(vault, telegram)
            const cleanUpVaultCheck = await program.getVault() as LoanVaultActive
            await telegram.log("executed clean-up part of script " + (result ? "successfull" : "with problems") + ". vault ratio after clean-up " + cleanUpVaultCheck.collateralRatio)

            await program.updateToState(result ? ProgramState.Waiting : ProgramState.Error, VaultMaxiProgramTransaction.None)
            return {
                statusCode: result ? 200 : 500
            }
        }
    }

    const collateralRatio = Number(vault.collateralRatio)
    console.log("starting with " + collateralRatio + " in vault, target " + settings.minCollateralRatio + " - " + settings.maxCollateralRatio + " token " + settings.LMToken)

    if (0 < collateralRatio && collateralRatio < settings.minCollateralRatio) {
        result = await program.decreaseExposure(vault, telegram)
    } else if (collateralRatio < 0 || collateralRatio > settings.maxCollateralRatio) {
        result = await program.increaseExposure(vault, telegram)
    }
    vault = await program.getVault() as LoanVaultActive
    await telegram.log("executed script " + (result ? "successfull" : "with problems") + ". vault ratio " + vaultcheck.collateralRatio)
    await program.updateToState(result ? ProgramState.Waiting : ProgramState.Error, VaultMaxiProgramTransaction.None)

    return {
        statusCode: result ? 200 : 500
    }
}
