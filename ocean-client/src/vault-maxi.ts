import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState, LoanVaultTokenAmount } from '@defichain/whale-api-client/dist/api/loan'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { ActivePrice } from '@defichain/whale-api-client/dist/api/prices'
import { VaultMaxiProgram, VaultMaxiState } from './programs/vault-maxi-program'
import { Logger } from './utils/logger'
import { Store, StoredSettings } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { BigNumber } from "@defichain/jellyfish-api-core";
import { TokenBalance } from '@defichain/jellyfish-transaction/dist'
import { CheckProgram } from './programs/check-program'


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
                const program = new CheckProgram(settings, new WalletSetup(MainNet, settings))
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

    const program = new VaultMaxiProgram(settings, new WalletSetup(MainNet, settings))
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

    // 2022-03-08 Krysh: Something went wrong on last execution, we need to clean up, whatever was done
    if (settings.state !== VaultMaxiState.Start && settings.state !== VaultMaxiState.Finish) {
        console.log("something went wrong on last execution, we clean up whatever was done")
        let result = await program.cleanUp(vault, telegram)
        await store.updateToState(VaultMaxiState.Start)
        const cleanUpVaultCheck = await program.getVault() as LoanVaultActive
        await telegram.log("executed clean-up part of script " + (result ? "successfull" : "with problems") + ". vault ratio after clean-up " + cleanUpVaultCheck.collateralRatio)
        return {
            statusCode: result ? 200 : 500
        }
    }

    await store.updateToState(VaultMaxiState.Start)
    const collateralRatio = Number(vault.collateralRatio)
    console.log("starting with " + collateralRatio + " in vault, target " + settings.minCollateralRatio + " - " + settings.maxCollateralRatio + " token " + settings.LMToken)

    let result = true
    if (0 < collateralRatio && collateralRatio < settings.minCollateralRatio) {
        await store.updateToState(VaultMaxiState.DecreaseExposure)
        result = await program.decreaseExposure(vault, telegram)
    } else if (collateralRatio < 0 || collateralRatio > settings.maxCollateralRatio) {
        await store.updateToState(VaultMaxiState.IncreaseExposure)
        result = await program.increaseExposure(vault, telegram)
    }
    vault = await program.getVault() as LoanVaultActive
    await telegram.log("executed script " + (result ? "successfull" : "with problems") + ". vault ratio " + vaultcheck.collateralRatio)
    await store.updateToState(VaultMaxiState.Finish)

    return {
        statusCode: result ? 200 : 500
    }
}
