import { MainNet } from "@defichain/jellyfish-network"
import { CheckedValues, CheckProgram } from "./programs/check-program"
import { Logger } from "./utils/logger"
import { Store } from "./utils/store"
import { Telegram } from "./utils/telegram"
import { WalletSetup } from "./utils/wallet-setup"

export async function main (): Promise<Object> {
    const store = new Store()
    let settings = await store.fetchSettings()

    const telegram = new Telegram(settings)

    Logger.default.setTelegram(telegram)

    var checkedValues = new CheckedValues()
    if (WalletSetup.canInitializeFrom(settings)) {
        const walletSetup = new WalletSetup(MainNet, settings)
        const program = new CheckProgram(store, walletSetup)
        await program.init()
        checkedValues = await program.reportCheck(telegram)
    }
    
    const response = {
        statusCode: 200,
        body: checkedValues,
    }
    return response
}


