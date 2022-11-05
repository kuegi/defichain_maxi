import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore } from './store'
import { StoreAWS, StoredAWSSettings } from './store_aws'
import { StoreConfig } from './store_config'
import { TelegramSettings } from './telegram'

export class StoredMaxiSettings extends StoredAWSSettings implements TelegramSettings {
  chatId: string = ''
  token: string = ''
  logChatId: string = ''
  logToken: string = ''
  minCollateralRatio: number = 200
  maxCollateralRatio: number = 250
  LMPair: string = 'GLD-DUSD'
  mainCollateralAsset: string = 'DFI'
  stableCoinArbBatchSize: number = -1
  reinvestThreshold: number | undefined
  reinvestPattern: string | undefined
  autoDonationPercentOfReinvest: number = 0

  shouldSkipNext: boolean = false

  heartBeatUrl: string | undefined
}

enum StoreKey {
  TelegramNotificationChatId = '/defichain-maxi/telegram/notifications/chat-id',
  TelegramNotificationToken = '/defichain-maxi/telegram/notifications/token',
  TelegramLogsChatId = '/defichain-maxi/telegram/logs/chat-id',
  TelegramLogsToken = '/defichain-maxi/telegram/logs/token',

  DeFiAddress = '/defichain-maxi/wallet/address',
  DeFiVault = '/defichain-maxi/wallet/vault',
  DeFiWalletSeed = '/defichain-maxi/wallet/seed',

  MinCollateralRatio = '/defichain-maxi/settings/min-collateral-ratio',
  MaxCollateralRatio = '/defichain-maxi/settings/max-collateral-ratio',
  LMToken = '/defichain-maxi/settings/lm-token',
  LMPair = '/defichain-maxi/settings/lm-pair',
  MainCollateralAsset = '/defichain-maxi/settings/main-collateral-asset',
  ReinvestThreshold = '/defichain-maxi/settings/reinvest',
  ReinvestPattern = '/defichain-maxi/settings/reinvest-pattern',
  StableArbBatchSize = '/defichain-maxi/settings/stable-arb-batch-size',
  AutoDonationPercentOfReinvest = '/defichain-maxi/settings/auto-donation-percent-of-reinvest',

  //optionals
  HeartBeatURL = '/defichain-maxi/settings/heartbeat-url',

  State = '/defichain-maxi/state',
  Skip = '/defichain-maxi/skip',
}

export interface IStoreMaxi extends IStore {
  updateToState(information: ProgramStateInformation): Promise<void>
  skipNext(): Promise<void>
  clearSkip(): Promise<void>
  fetchSettings(): Promise<StoredMaxiSettings>
}

// handle AWS Paramter
export class StoreAWSMaxi extends StoreAWS implements IStoreMaxi {
  constructor() {
    super()
  }

  async updateToState(information: ProgramStateInformation): Promise<void> {
    await this.updateParameter(this.postfixedKey(StoreKey.State), ProgramStateConverter.toValue(information))
  }

  async skipNext(): Promise<void> {
    await this.updateParameter(this.postfixedKey(StoreKey.Skip), 'true')
  }

  async clearSkip(): Promise<void> {
    await this.updateParameter(this.postfixedKey(StoreKey.Skip), 'false')
  }

  async fetchSettings(): Promise<StoredMaxiSettings> {
    // first check environment

    let storePostfix = process.env.VAULTMAXI_STORE_POSTFIX ?? process.env.VAULTMAXI_STORE_POSTIX ?? ''

    this.paramPostFix = storePostfix
    let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

    let DeFiAddressKey = this.postfixedKey(StoreKey.DeFiAddress)
    let DeFiVaultKey = this.postfixedKey(StoreKey.DeFiVault)
    let MinCollateralRatioKey = this.postfixedKey(StoreKey.MinCollateralRatio)
    let MaxCollateralRatioKey = this.postfixedKey(StoreKey.MaxCollateralRatio)
    let ReinvestThreshold = this.postfixedKey(StoreKey.ReinvestThreshold)
    let ReinvestPattern = this.postfixedKey(StoreKey.ReinvestPattern)
    let AutoDonationPercentOfReinvestKey = this.postfixedKey(StoreKey.AutoDonationPercentOfReinvest)
    let LMTokenKey = this.postfixedKey(StoreKey.LMToken)
    let LMPairKey = this.postfixedKey(StoreKey.LMPair)
    let MainCollAssetKey = this.postfixedKey(StoreKey.MainCollateralAsset)
    let StateKey = this.postfixedKey(StoreKey.State)
    let SkipKey = this.postfixedKey(StoreKey.Skip)
    let StableArbBatchSizeKey = this.postfixedKey(StoreKey.StableArbBatchSize)

    let HeartBeatKey = this.postfixedKey(StoreKey.HeartBeatURL)

    //store only allows to get 10 parameters per request
    const parameters = await this.fetchParameters([
      StoreKey.TelegramNotificationChatId,
      StoreKey.TelegramNotificationToken,
      StoreKey.TelegramLogsChatId,
      StoreKey.TelegramLogsToken,
      SkipKey,
      StableArbBatchSizeKey,
      HeartBeatKey,
      ReinvestPattern,
      DeFiAddressKey,
      DeFiVaultKey,
      MinCollateralRatioKey,
      MaxCollateralRatioKey,
      LMTokenKey,
      LMPairKey,
      MainCollAssetKey,
      StateKey,
      ReinvestThreshold,
      AutoDonationPercentOfReinvestKey,
    ])

    const settings = new StoredMaxiSettings()
    settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
    settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
    settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
    settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
    settings.address = this.getValue(DeFiAddressKey, parameters)
    settings.vault = this.getValue(DeFiVaultKey, parameters)
    settings.minCollateralRatio = this.getNumberValue(MinCollateralRatioKey, parameters) ?? settings.minCollateralRatio
    settings.maxCollateralRatio = this.getNumberValue(MaxCollateralRatioKey, parameters) ?? settings.maxCollateralRatio
    settings.LMPair = this.getOptionalValue(LMPairKey, parameters) ?? this.getValue(LMTokenKey, parameters) + '-DUSD'
    settings.mainCollateralAsset = this.getOptionalValue(MainCollAssetKey, parameters) ?? 'DFI'
    settings.reinvestThreshold = this.getNumberValue(ReinvestThreshold, parameters)
    settings.reinvestPattern = this.getOptionalValue(ReinvestPattern, parameters)
    settings.autoDonationPercentOfReinvest =
      this.getNumberValue(AutoDonationPercentOfReinvestKey, parameters) ?? settings.autoDonationPercentOfReinvest
    settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))
    settings.stableCoinArbBatchSize = this.getNumberValue(StableArbBatchSizeKey, parameters) ?? -1
    settings.shouldSkipNext = (this.getValue(SkipKey, parameters) ?? 'false') === 'true'

    //optionals
    settings.heartBeatUrl = this.getOptionalValue(HeartBeatKey, parameters)

    settings.seed = await this.readSeed(seedkey)
    return settings
  }
}
