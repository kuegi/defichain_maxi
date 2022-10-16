import SSM from 'aws-sdk/clients/ssm'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'

// handle AWS Paramter
export class StoreAWSSendDFI implements IStore {
  private ssm: SSM
  readonly settings: StoredSettings

  constructor() {
    this.ssm = new SSM()
    this.settings = new StoredSettings()
  }
  updateToState(information: ProgramStateInformation): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async skipNext(): Promise<void> {}
  async clearSkip(): Promise<void> {}

  async fetchSettings(): Promise<StoredSettings> {
    // first check environment

    let storePostfix = process.env.VAULTMAXI_STORE_POSTFIX ?? process.env.VAULTMAXI_STORE_POSTIX ?? ''

    this.settings.paramPostFix = storePostfix
    let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

    let DeFiFromAddressKey = StoreKey.DeFiFromAddress.replace('-maxi', '-maxi' + storePostfix)
    let DeFiToAddressKey = StoreKey.DeFiToAddress.replace('-maxi', '-maxi' + storePostfix)
    let SendThreshold = StoreKey.SendThreshold.replace('-maxi', '-maxi' + storePostfix)

    //store only allows to get 10 parameters per request
    let parameters =
      (
        await this.ssm
          .getParameters({
            Names: [
              StoreKey.TelegramNotificationChatId,
              StoreKey.TelegramNotificationToken,
              StoreKey.TelegramLogsChatId,
              StoreKey.TelegramLogsToken,
              DeFiFromAddressKey,
              DeFiToAddressKey,
              SendThreshold,
            ],
          })
          .promise()
      ).Parameters ?? []

    let decryptedSeed
    try {
      decryptedSeed = await this.ssm
        .getParameter({
          Name: seedkey,
          WithDecryption: true,
        })
        .promise()
    } catch (e) {
      console.error('Seed Parameter not found!')
      decryptedSeed = undefined
    }
    this.settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
    this.settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
    this.settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
    this.settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
    this.settings.address = this.getValue(DeFiFromAddressKey, parameters)
    this.settings.toAddress = this.getValue(DeFiToAddressKey, parameters)
    this.settings.sendThreshold = this.getNumberValue(SendThreshold, parameters)

    let seedList = decryptedSeed?.Parameter?.Value?.replace(/[ ,]+/g, ' ')
    this.settings.seed = seedList?.trim().split(' ') ?? []
    return this.settings
  }

  private getValue(key: string, parameters: SSM.ParameterList): string {
    return parameters?.find((element) => element.Name === key)?.Value as string
  }

  private getNumberValue(key: string, parameters: SSM.ParameterList): number | undefined {
    let value = parameters?.find((element) => element.Name === key)?.Value
    return value ? +value : undefined
  }
}

enum StoreKey {
  TelegramNotificationChatId = '/defichain-maxi/telegram/notifications/chat-id',
  TelegramNotificationToken = '/defichain-maxi/telegram/notifications/token',
  TelegramLogsChatId = '/defichain-maxi/telegram/logs/chat-id',
  TelegramLogsToken = '/defichain-maxi/telegram/logs/token',

  DeFiWalletSeed = '/defichain-maxi/wallet/seed',
  DeFiFromAddress = '/defichain-maxi/wallet-send/fromAddress',
  DeFiToAddress = '/defichain-maxi/wallet-send/toAddress',

  SendThreshold = '/defichain-maxi/settings-send/threshold',
}
