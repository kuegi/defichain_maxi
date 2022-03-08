import { StoredSettings } from "../utils/store";
import { Telegram } from "../utils/telegram";
import { WalletSetup } from "../utils/wallet-setup";
import { CommonProgram } from "./common-program";

export class CheckProgram extends CommonProgram {
    static canDoCheck(settings: StoredSettings): boolean {
        return WalletSetup.canInitializeFrom(settings)
    }

    static buildCurrentSettingsIntoMessage(settings: StoredSettings): string {
        return "Please check your ParameterStore settings, something is not successfully configured."
            + settings.seed.length + " words in seedphrase,"
            + "trying vault " + settings.vault + " in " + settings.address + ". "
            + "thresholds " + settings.minCollateralRatio + " - " + settings.maxCollateralRatio + " in " + settings.LMToken
    }

    async reportCheck(telegram: Telegram): Promise<CheckedValues> {
        var values = new CheckedValues()

        let walletAddress = await this.getAddress()
        let vault = await this.getVault()
        const lmPair= this.settings.LMToken+"-DUSD"
        let pool = await this.getPool(lmPair)

        values.address= walletAddress === this.settings.address ? walletAddress : undefined
        values.vault = vault?.vaultId === this.settings.vault && vault.ownerAddress == walletAddress ? vault.vaultId : undefined
        values.minCollateralRatio = this.settings.minCollateralRatio
        values.maxCollateralRatio = this.settings.maxCollateralRatio
        values.LMToken = (pool && pool.symbol == lmPair) ? this.settings.LMToken : undefined
        values.reinvest= this.settings.reinvestThreshold

        const message = this.constructMessage( values)
        console.log(message)
        await telegram.send(message)
        await telegram.log("log channel active")

        return values
    }

    constructMessage(checkedValues: CheckedValues): string {
        return ""
        + "Setup-Check result\n"
        + (checkedValues.vault?("monitoring vault "+checkedValues.vault):"no vault found") +"\n"
        + (checkedValues.address?("from address " + checkedValues.address):"no valid address")+"\n"
        + "Set collateral ratio range " + checkedValues.minCollateralRatio + "-" + checkedValues.maxCollateralRatio + "\n"
        + (checkedValues.LMToken ? ("Set dToken "+ checkedValues.LMToken ) : "no pool found for token ") +"\n"
        + (checkedValues.reinvest ? ("Will reinvest above "+checkedValues.reinvest+" DFI"): "Will not reinvest")
    }

    getYesOrNo(bool: boolean): string {
        return bool ? "Yes\n" : "No\n"
    }
}

export class CheckedValues {
    //used addres. only set if wallet initialized and address found
    address: string | undefined
    // monitored vault. only set if vault found
    vault: string | undefined
    
    minCollateralRatio: number = 0
    maxCollateralRatio: number = -1
    LMToken: string | undefined
    reinvest: number | undefined
}