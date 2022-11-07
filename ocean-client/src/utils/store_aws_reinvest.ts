import SSM from 'aws-sdk/clients/ssm'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'
import { StoreAWS, StoredAWSSettings } from './store_aws'

export class StoredReinvestSettings extends StoredAWSSettings {
  chatId: string = ''
  token: string = ''
  logChatId: string = ''
  logToken: string = ''

  address: string = ''
  seed: string[] = []
  LMPair: string = 'GLD-DUSD'
  reinvestThreshold: number | undefined
  reinvestPattern: string | undefined
  autoDonationPercentOfReinvest: number = 0
}

enum StoreKey {
  TelegramNotificationChatId = '/defichain-maxi/telegram/notifications/chat-id',
  TelegramNotificationToken = '/defichain-maxi/telegram/notifications/token',
  TelegramLogsChatId = '/defichain-maxi/telegram/logs/chat-id',
  TelegramLogsToken = '/defichain-maxi/telegram/logs/token',

  DeFiAddress = '/defichain-maxi/wallet-reinvest/address',
  DeFiWalletSeed = '/defichain-maxi/wallet/seed',

  LMPair = '/defichain-maxi/settings-reinvest/lm-pair',
  ReinvestThreshold = '/defichain-maxi/settings-reinvest/reinvest',
  AutoDonationPercentOfReinvest = '/defichain-maxi/settings-reinvest/auto-donation-percent-of-reinvest',

  State = '/defichain-maxi/state-reinvest',
}

// handle AWS Paramter
export class StoreAWSReinvest extends StoreAWS implements IStore {
  constructor() {
    super()
  }

  async updateToState(information: ProgramStateInformation): Promise<void> {
    await this.updateParameter(this.postfixedKey(StoreKey.State), ProgramStateConverter.toValue(information))
  }

  async fetchSettings(): Promise<StoredReinvestSettings> {
    // first check environment

    let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

    let DeFiAddressKey = this.postfixedKey(StoreKey.DeFiAddress)
    let ReinvestThreshold = this.postfixedKey(StoreKey.ReinvestThreshold)
    let AutoDonationPercentOfReinvestKey = this.postfixedKey(StoreKey.AutoDonationPercentOfReinvest)
    let LMPairKey = this.postfixedKey(StoreKey.LMPair)
    let StateKey = this.postfixedKey(StoreKey.State)

    //store only allows to get 10 parameters per request
    const parameters = await this.fetchParameters([
      StoreKey.TelegramNotificationChatId,
      StoreKey.TelegramNotificationToken,
      StoreKey.TelegramLogsChatId,
      StoreKey.TelegramLogsToken,
      DeFiAddressKey,
      LMPairKey,
      ReinvestThreshold,
      AutoDonationPercentOfReinvestKey,
      StateKey,
    ])

    const settings: StoredReinvestSettings = new StoredReinvestSettings()
    settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
    settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
    settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
    settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
    settings.address = this.getValue(DeFiAddressKey, parameters)
    settings.LMPair = this.getValue(LMPairKey, parameters)
    settings.reinvestThreshold = this.getNumberValue(ReinvestThreshold, parameters)
    settings.autoDonationPercentOfReinvest =
      this.getNumberValue(AutoDonationPercentOfReinvestKey, parameters) ?? settings.autoDonationPercentOfReinvest
    settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))

    settings.seed = await this.readSeed(seedkey)
    return settings
  }
}

