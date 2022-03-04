import { MainNet } from '@defichain/jellyfish-network'
import { LoanVaultActive, LoanVaultState, LoanVaultTokenAmount } from '@defichain/whale-api-client/dist/api/loan'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { ActivePrice } from '@defichain/whale-api-client/dist/api/prices'
import { VaultMaxiProgram } from './programs/vault-maxi-program'
import { Logger } from './utils/logger'
import { Store, StoredSettings } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { BigNumber } from "@defichain/jellyfish-api-core";
import { TokenBalance } from '@defichain/jellyfish-transaction/dist'


class SettingsOverride {
    minCollateralRatio: number | undefined
    maxCollateralRatio: number | undefined
    LMToken: string | undefined
}

class maxiEvent {
    overrideSettings:SettingsOverride | undefined
}

export async function main(event:maxiEvent): Promise<Object> {
    let settings = await new Store().fetchSettings()

    if(event) {
        console.log("received event "+JSON.stringify(event))
        if (event.overrideSettings) {
            if(event.overrideSettings.maxCollateralRatio)
                settings.maxCollateralRatio= event.overrideSettings.maxCollateralRatio
            if(event.overrideSettings.minCollateralRatio)
                settings.minCollateralRatio= event.overrideSettings.minCollateralRatio
            if(event.overrideSettings.LMToken)
                settings.LMToken= event.overrideSettings.LMToken
        }
    }

    const telegram = new Telegram(settings)
    telegram.prefix= "[Maxi "+settings.vault.substring(0,6)+"]"

    const program = new VaultMaxiProgram(settings, new WalletSetup(MainNet, settings))
    await program.init()


    const vaultcheck= await program.getVault()
    if(vaultcheck?.state != LoanVaultState.ACTIVE) {
        await telegram.send("Error: vault not active, its "+vaultcheck.state)
        return {
            statusCode: 500
        }
    }
    
    const vault : LoanVaultActive = vaultcheck
    const collateralRatio = Number(vault.collateralRatio)
    console.log("starting with "+collateralRatio+" in vault, target "+settings.minCollateralRatio+" - "+settings.maxCollateralRatio+" token "+settings.LMToken)
    
    let result= true
    if(0 < collateralRatio  && collateralRatio < settings.minCollateralRatio) {
        result= await program.decreaseExposure(vault,telegram)
    } else if(collateralRatio < 0 || collateralRatio > settings.maxCollateralRatio) {
        result= await program.increaseExposure(vault,telegram)
    }

    return {
        statusCode: result ? 200 : 500
    }
}
