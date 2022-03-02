import { StoredSettings } from "../utils/store";
import { CommonProgram } from "./common-program";

export class CheckProgram extends CommonProgram {
    async basicCheck(settings: StoredSettings): Promise<CheckedValues> {
        var values = new CheckedValues()

        let walletAddress = await this.getAddress()
        let vault = await this.getVault()

        values.couldInitializeWallet = true
        values.hasSameAddress = walletAddress === settings.address
        values.hasVaultSpecified = settings.vault !== undefined
        if (values.hasVaultSpecified) {
            values.hasSameVault = vault?.vaultId === settings.vault
        }

        return values
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