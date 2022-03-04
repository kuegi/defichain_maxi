import { LoanVaultActive, LoanVaultLiquidated } from "@defichain/whale-api-client/dist/api/loan";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { ActivePrice } from "@defichain/whale-api-client/dist/api/prices";
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
        //values.vault= vault
        let dfi = await this.getTokenBalance("DFI")
        values.balances.set("DFI", dfi?.amount ?? "-" )
        let dusd = await this.getTokenBalance("DUSD")
        values.balances.set("DUSD", dusd?.amount ?? "-")
        let qqq = await this.getTokenBalance("QQQ")
        values.balances.set("QQQ", qqq?.amount ?? "-")
    
        values.pool= await this.getPool(settings.LMToken+"-DUSD")
        values.price= await this.getFixedIntervalPrice(settings.LMToken)

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

    vault : LoanVaultActive | LoanVaultLiquidated | undefined = undefined

    balances : Map<string, string> = new Map<string,string>()
    pool: PoolPairData | undefined;
    price: ActivePrice | undefined;

}