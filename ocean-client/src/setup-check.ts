import { MainNet } from "@defichain/jellyfish-network"
import { CheckedValues, CheckProgram } from "./programs/check-program"
import { Logger } from "./utils/logger"
import { Store } from "./utils/store"
import { Telegram } from "./utils/telegram"
import { WalletSetup } from "./utils/wallet-setup"

export async function main (): Promise<Object> {
    const store = new Store()
    let settings = await store.fetchSettings()

    const telegram = new Telegram()
    telegram.chatId = settings.chatId
    telegram.token = settings.token
    telegram.logChatId = settings.logChatId
    telegram.logToken = settings.logToken

    Logger.default.setTelegram(telegram)

    var checkedValues = new CheckedValues()
    if (WalletSetup.canInitializeFrom(settings)) {
        const walletSetup = new WalletSetup(MainNet, settings)
        const program = new CheckProgram(settings, walletSetup)
        checkedValues = await program.basicCheck(settings)
    }

    // 2022-03-02 Krysh: Name and everything needs to be defined somewhere else
    // Just putting in here ideas, how it could look like

    const message = ""
    + "[OceanClient] Setup-Check result\n"
    + "Could initialize wallet? " + getYesOrNo(checkedValues.couldInitializeWallet)
    + "Configured address is same to wallet address? " + getYesOrNo(checkedValues.hasSameAddress)
    + "A vault is configured? " + getYesOrNo(checkedValues.hasVaultSpecified)
    + "Configured vault is same to wallet address' vault? " + getYesOrNo(checkedValues.hasSameVault)

    
    const response = {
        statusCode: 200,
        body: checkedValues,
    }
    return response
}

function getYesOrNo(bool: boolean): string {
    return bool ? "Yes\n" : "No\n"
}
