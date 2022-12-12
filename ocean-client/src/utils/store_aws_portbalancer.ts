import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IReinvestSettings } from './reinvestor'
import { IStore } from './store'
import { StoreAWS, StoredAWSSettings } from './store_aws'
import { TelegramSettings } from './telegram'

export class StoredBalancerSettings extends StoredAWSSettings implements TelegramSettings {
  chatId: string = ''
  token: string = ''
  logChatId: string = ''
  logToken: string = ''
  rebalanceThreshold: number = 5
  portfolioPattern: string = ''

  oceanUrl: string | undefined
}

enum StoreKey {
  TelegramNotificationChatId = '/defichain-maxi/telegram/notifications/chat-id',
  TelegramNotificationToken = '/defichain-maxi/telegram/notifications/token',
  TelegramLogsChatId = '/defichain-maxi/telegram/logs/chat-id',
  TelegramLogsToken = '/defichain-maxi/telegram/logs/token',

  DeFiAddress = '/defichain-maxi/wallet/address',
  DeFiWalletSeed = '/defichain-maxi/wallet/seed',

  RebalanceThreshold = '/defichain-maxi/settings/rebalance-threshold',
  PortfolioPattern = '/defichain-maxi/settings/portfolio-pattern',

  //optionals
  OceanUrls = '/defichain-maxi/settings/ocean-urls',

  State = '/defichain-maxi/state-balancer',
}

// handle AWS Paramter
export class StoreAWSBalancer extends StoreAWS {
  constructor() {
    super()
  }

  async updateToState(information: ProgramStateInformation): Promise<void> {
    await this.updateParameter(this.postfixedKey(StoreKey.State), ProgramStateConverter.toValue(information))
  }

  async fetchSettings(): Promise<StoredBalancerSettings> {
    // first check environment

    let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

    let DeFiAddressKey = this.postfixedKey(StoreKey.DeFiAddress)
    let StateKey = this.postfixedKey(StoreKey.State)
    let RebalanceThresholdKey = this.postfixedKey(StoreKey.RebalanceThreshold)
    let PortfolioPatternKey = this.postfixedKey(StoreKey.PortfolioPattern)
    let OceanUrlKey = this.postfixedKey(StoreKey.OceanUrls)

    //store only allows to get 10 parameters per request
    const parameters = await this.fetchParameters([
      StoreKey.TelegramNotificationChatId,
      StoreKey.TelegramNotificationToken,
      StoreKey.TelegramLogsChatId,
      StoreKey.TelegramLogsToken,
      RebalanceThresholdKey,
      PortfolioPatternKey,
      DeFiAddressKey,
      StateKey,
      OceanUrlKey,
    ])

    const settings = new StoredBalancerSettings()
    settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
    settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
    settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
    settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
    settings.address = this.getValue(DeFiAddressKey, parameters)
    settings.portfolioPattern = this.getValue(PortfolioPatternKey, parameters)
    settings.rebalanceThreshold = this.getNumberValue(RebalanceThresholdKey, parameters)
    settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))
    settings.oceanUrl = this.getOptionalValue(OceanUrlKey, parameters)

    settings.seed = await this.readSeed(seedkey)
    return settings
  }
}
