import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { Telegram } from '../utils/telegram'
import { CommonProgram, ProgramState } from './common-program'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { WalletSetup } from '../utils/wallet-setup'
import { AddressToken } from '@defichain/whale-api-client/dist/api/address'
import { Prevout } from '@defichain/jellyfish-transaction-builder'
import { CTransaction } from '@defichain/jellyfish-transaction/dist'
import { VERSION } from '../lm-reinvest'
import { StoreAWSReinvest, StoredReinvestSettings } from '../utils/store_aws_reinvest'
import {
  checkAndDoReinvest,
  checkReinvestTargets,
  DONATION_MAX_PERCENTAGE,
  getReinvestMessage,
  initReinvestTargets,
  ReinvestTarget,
} from '../utils/reinvestor'
import { LogLevel } from './vault-maxi-program'

export enum LMReinvestProgramTransaction {
  None = 'none',
  AddLiquidity = 'addliquidity',
  Swap = 'swap',
}
export class LMReinvestProgram extends CommonProgram {
  private reinvestTargets: ReinvestTarget[] = []

  constructor(store: StoreAWSReinvest, settings: StoredReinvestSettings, walletSetup: WalletSetup) {
    super(store, settings, walletSetup)
  }

  private getSettings(): StoredReinvestSettings {
    return this.settings as StoredReinvestSettings
  }

  getVersion(): string {
    return VERSION
  }

  async init(): Promise<boolean> {
    let result = await super.init()
    let pattern = this.getSettings().reinvestPattern ?? ''
    this.reinvestTargets = await initReinvestTargets(pattern, this)

    return result
  }

  async doMaxiChecks(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false
    }

    const utxoBalance = await this.getUTXOBalance()
    if (utxoBalance.lte(1e-4)) {
      //1 tx is roughly 2e-6 fee, one action mainly 3 tx -> 6e-6 fee. we want at least 10 actions safety -> below 1e-4 we warn
      const message =
        'your UTXO balance is running low in ' +
        this.getSettings().address +
        ', only ' +
        utxoBalance.toFixed(5) +
        ' DFI left. Please replenish to prevent any errors'
      await telegram.send(message, LogLevel.WARNING)
      console.warn(message)
    }

    // sanity check for auto-donate feature, do NOT allow auto-donate above our defined max percentage
    this.getSettings().autoDonationPercentOfReinvest = Math.min(
      this.getSettings().autoDonationPercentOfReinvest,
      DONATION_MAX_PERCENTAGE,
    )
    //check reinvest pattern
    if (!(await checkReinvestTargets(this.reinvestTargets, telegram))) {
      this.reinvestTargets = []
    }

    return true
  }

  async doAndReportCheck(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false //report already send inside
    }

    let walletAddress = this.getAddress()

    let message =
      'Setup-Check result:\n' +
      (walletAddress ? 'monitoring address ' + walletAddress : 'no valid address') +
      '\n' +
      (this.canSign()
        ? 'got valid key: will send tx automatically'
        : 'no valid key, will provide tx for manual signing')

    message +=
      getReinvestMessage(this.reinvestTargets, this.getSettings(), this) +
      '\n' +
      'using ocean at: ' +
      this.walletSetup.url

    console.log(message)
    console.log('using telegram for log: ' + telegram.logToken + ' chatId: ' + telegram.logChatId)
    console.log('using telegram for notification: ' + telegram.token + ' chatId: ' + telegram.chatId)
    await telegram.send(message, LogLevel.ERROR)
    await telegram.send('log channel active', LogLevel.VERBOSE)

    return true
  }

  async checkAndDoReinvest(balances: Map<string, AddressToken>, telegram: Telegram): Promise<boolean> {
    const maxReinvestThreshold = Math.max(
      this.getSettings().reinvestThreshold! * 2,
      +(process.env.VAULTMAXI_MAXREINVEST ?? 40),
    ) //anything below 20 DFI is considered a "reinvest all the time"

    const result = await checkAndDoReinvest(
      maxReinvestThreshold,
      balances,
      telegram,
      this,
      this.getSettings(),
      this.reinvestTargets,
    )

    return result.addressChanged
  }
}
