import { StoredSettings } from "../utils/store";
import { Telegram } from "../utils/telegram";
import { WalletSetup } from "../utils/wallet-setup";
import { CommonProgram } from "./common-program";

export class CheckProgram extends CommonProgram {
    static canDoCheck(settings: StoredSettings): boolean {
        return WalletSetup.canInitializeFrom(settings)
    }

    async reportCheck(telegram: Telegram): Promise<CheckedValues> {
        var values = new CheckedValues()

        let walletAddress = await this.getAddress()
        let vault = await this.getVault()

        values.couldInitializeWallet = true
        values.hasSameAddress = walletAddress === this.settings.address
        values.hasVaultSpecified = this.settings.vault !== undefined
        if (values.hasVaultSpecified) {
            values.hasSameVault = vault?.vaultId === this.settings.vault
        }

        const message = this.constructMessage(this.settings, values)
        console.log(message)
        await telegram.send(message)

        return values
    }

    constructMessage(settings: StoredSettings, checkedValues: CheckedValues): string {
        return ""
        + "Setup-Check result\n"
        + "Could initialize wallet? " + this.getYesOrNo(checkedValues.couldInitializeWallet)
        + "Configured address is same to wallet address? " + this.getYesOrNo(checkedValues.hasSameAddress)
        + "A vault is configured? " + this.getYesOrNo(checkedValues.hasVaultSpecified)
        + "Configured vault is same to wallet address' vault? " + this.getYesOrNo(checkedValues.hasSameVault)
        + "Set collateral ratio range " + settings.minCollateralRatio + "-" + settings.maxCollateralRatio + "\n"
        + "Set dToken " + settings.LMToken
    }

    getYesOrNo(bool: boolean): string {
        return bool ? "Yes\n" : "No\n"
    }
}

export class CheckedValues {
    // Indicates if JellyfishWallet could be initialized
    couldInitializeWallet: boolean = false
    // Indicates if ParameterStore address is equal to wallet address 
    hasSameAddress: boolean = false
    // Indicates if a vault exists in ParameterStore
    hasVaultSpecified: boolean = false
    // Indicates if ParameterStore vault is equal to wallet address' vault
    hasSameVault: boolean = false
}