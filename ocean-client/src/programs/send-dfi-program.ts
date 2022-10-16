import { IStore } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { WalletSetup } from '../utils/wallet-setup'
import { CommonProgram } from './common-program'
import { fromAddress } from '@defichain/jellyfish-address'
import { AccountToUtxos, TransactionSegWit } from '@defichain/jellyfish-transaction/dist'
import BigNumber from 'bignumber.js'

export class SendDFIProgramm extends CommonProgram {
  readonly toAddress: string
  readonly threshold: number
  readonly sendAll: boolean

  constructor(store: IStore, walletSetup: WalletSetup) {
    super(store, walletSetup)
    this.toAddress = this.settings.toAddress
    this.threshold = this.settings.sendThreshold ?? 1
    this.sendAll = this.settings.sendAll
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

    const balances = await this.getTokenBalances()
    const dfiBalance = balances.get('DFI')?.amount ?? '0'
    console.log('dfi: ' + dfiBalance)

    const fromBalance = new BigNumber(dfiBalance)

    let fromUtxos: BigNumber
    if (this.sendAll) {
      fromUtxos = utxoBalance
    } else {
      fromUtxos = utxoBalance.isGreaterThan(1) ? utxoBalance.minus(1) : new BigNumber(0)
    }
    let amountToUse = fromUtxos.plus(fromBalance)
    console.log('amountToUse: ' + amountToUse)

    if (amountToUse.toNumber() < this.threshold) {
      console.log('Treshold not reached')
      await telegram.log('threshold not reached.')
      return true
    }

    const account = await this.walletSetup.getAccount(this.getAddress())

    if (fromBalance.toNumber() > 0) {
      const accountToUtxos: AccountToUtxos = {
        from: this.script!,
        balances: [{ token: 0, amount: fromBalance }],
        mintingOutputsStart: 2,
      }

      const txn = await account?.withTransactionBuilder()?.account.accountToUtxos(accountToUtxos, this.script!)
      if (txn === undefined) {
        await telegram.send('ERROR: transactionSegWit is undefined')
        console.error('transactionSegWit is undefinedd')
        return false
      }

      if (!(await this.sendAndWait(txn, telegram))) {
        return false
      }
    }

    const decodedToAddress = fromAddress(this.toAddress, this.walletSetup.network.name)
    if (decodedToAddress === undefined) {
      console.error('decodedFromAddress is undefined')
      await telegram.send('ERROR: decodedFromAddress is undefined')
      return false
    }
    let txn: TransactionSegWit | undefined
    if (this.sendAll) {
      txn = await account?.withTransactionBuilder()?.utxo.sendAll(decodedToAddress.script)
    } else {
      txn = await account?.withTransactionBuilder()?.utxo.send(amountToUse, decodedToAddress.script, this.script!)
    }

    if (txn === undefined) {
      await telegram.send('ERROR: transactionSegWit is undefined')
      console.error('transactionSegWit is undefinedd')
      return false
    }

    if (!(await this.sendAndWait(txn, telegram))) {
      return false
    }

    await telegram.log('send ' + amountToUse.toFixed(4) + '@UTXO to ' + this.toAddress)
    await telegram.send('send ' + amountToUse.toFixed(4) + '@UTXO to ' + this.toAddress)

    return true
  }

  async sendAndWait(txn: TransactionSegWit, telegram: Telegram): Promise<boolean> {
    const tx = await this.send(txn)
    if (!(await this.waitForTx(tx.txId))) {
      await telegram.send('ERROR: sending of DFI failed')
      console.error('sending DFI failed')
      return false
    }
    return true
  }
}
