import { MainNet } from '@defichain/jellyfish-network'
import { ReinvestProgram } from './programs/reinvest-program'
import { Logger } from './utils/logger'
import { Store } from './utils/store'
import { Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'

export async function main(): Promise<Object> {
    let settings = await new Store().fetchSettings()

    const telegram = new Telegram(settings)

    Logger.default.setTelegram(telegram)

    const walletSetup = new WalletSetup(MainNet, settings)
    const program = new ReinvestProgram(settings, walletSetup)

    const address = await program.getAddress()
    const balance = await program.getUTXOBalance()
    const balanceToken = await program.getTokenBalance('DFI')

    let body = {
        address: address,
        addressSame: settings.address === address,
        balance: balance,
        balanceToken: balanceToken
    }

    // var utxos = await program.getUTXOBalance()
    // console.log("start utxos = " + utxos)
    // var balance = await program.getTokenBalance('DFI')
    // console.log("start balance = " + balance?.amount + " " + balance?.symbol)

    // const success = await program.depositToVault('DFI', new BigNumber(1))

    // utxos = await program.getUTXOBalance()
    // console.log("end utxos = " + utxos)
    // balance = await program.getTokenBalance('DFI')
    // console.log("end balance = " + balance?.amount + " " + balance?.symbol)

    // let body = {
    //     balance: balance,
    //     isTransactionSuccessful: success
    // }

    const response = {
        statusCode: 200,
        body: body
    }
    return response
}