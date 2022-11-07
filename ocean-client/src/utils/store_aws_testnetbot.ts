import SSM from 'aws-sdk/clients/ssm'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'
import { StoreAWS, StoredAWSSettings } from './store_aws'
import { TelegramSettings } from './telegram'

enum StoreKey {
  TelegramLogsChatId = '/defichain-maxi/telegram/notifications/chat-id',
  TelegramLogsToken = '/defichain-maxi/telegram/notifications/token',

  DeFiAddress = '/defichain-maxi/wallet/address',
  DeFiWalletSeed = '/defichain-maxi/wallet/seed',

  State = '/defichain-maxi/state',
}

export class StoredTestnetBotSettings extends StoredAWSSettings implements TelegramSettings {
  chatId: string = ''
  token: string = ''
  logChatId: string = ''
  logToken: string = ''

  address: string = ''
  seed: string[] = []
}

// handle AWS Paramter
export class StoreAWSTestnetBot extends StoreAWS implements IStore {
  constructor() {
    super()
  }

  updateToState(information: ProgramStateInformation): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async fetchSettings(): Promise<StoredTestnetBotSettings> {
    // first check environment

    let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

    let DeFiAddressKey = StoreKey.DeFiAddress
    let StateKey = StoreKey.State

    //store only allows to get 10 parameters per request
    let parameters = await this.fetchParameters([
      StoreKey.TelegramLogsChatId,
      StoreKey.TelegramLogsToken,
      DeFiAddressKey,
      StateKey,
    ])

    const settings = new StoredTestnetBotSettings()
    settings.token = this.getValue(StoreKey.TelegramLogsChatId, parameters)
    settings.chatId = this.getValue(StoreKey.TelegramLogsToken, parameters)
    settings.address = this.getValue(DeFiAddressKey, parameters)
    settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))

    settings.seed = await this.readSeed(seedkey)
    return settings
  }
}

