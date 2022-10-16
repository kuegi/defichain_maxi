import { IStore } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { WalletSetup } from '../utils/wallet-setup'
import { CommonProgram } from './common-program'
import { fromAddress } from '@defichain/jellyfish-address'

export class SendProgramm extends CommonProgram {
  readonly toAddress: string
  readonly threshold: number

  constructor(store: IStore, walletSetup: WalletSetup) {
    super(store, walletSetup)
    this.toAddress = this.settings.toAddress
    this.threshold = this.settings.sendThreshold ?? 1
  }

  async doChecks(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false
    }

    return true
  }

  async doSend(telegram: Telegram): Promise<boolean> {
    if (!this.settings.toAddress) {
      return false
    }
    const utxoBalance = await this.getUTXOBalance()
    console.log('utxo: ' + utxoBalance)

    if (utxoBalance.toNumber() < this.threshold) {
      console.log('Treshold not reached')
      await telegram.log('threshold not reached.')
      return true
    }

    const account = await this.walletSetup.getAccount(this.getAddress())
    const toScript = fromAddress(this.toAddress, this.walletSetup.network.name)!.script
    const txn = await account?.withTransactionBuilder()?.utxo.sendAll(toScript)

    if (txn === undefined) {
      await telegram.send('ERROR: transactionSegWit is undefined')
      console.error('transactionSegWit is undefinedd')
      return false
    }

    const tx = await this.send(txn)
    if (!(await this.waitForTx(tx.txId))) {
      await telegram.send('ERROR: sending of DFI failed')
      console.error('sending DFI failed')
      return false
    }

    await telegram.log('send ' + utxoBalance.toFixed(4) + '@UTXO to ' + this.toAddress)
    await telegram.send('send ' + utxoBalance.toFixed(4) + '@UTXO to ' + this.toAddress)

    return true
  }
}
