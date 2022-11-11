import SSM from 'aws-sdk/clients/ssm'
import { Bot, BotType, LM_REINVEST, VAULT_MAXI } from './available-bot'

// handle AWS Paramter
export class Store {
  private ssm: SSM
  private stateParameters: string[]
  readonly settings: StoredSettings

  constructor() {
    this.ssm = new SSM()
    this.stateParameters = []
    this.settings = new StoredSettings()
  }

  async searchForBots(): Promise<void> {
    const params = {
      ParameterFilters: [
        {
          Key: 'Name',
          Option: 'Contains',
          Values: ['state'],
        },
      ],
    }
    const parameters = await this.ssm.describeParameters(params).promise()

    this.stateParameters =
      parameters.Parameters?.map((p) => {
        return p.Name ?? ''
      }) ?? []
  }

  async updateExecutedMessageId(id: number): Promise<unknown> {
    return this.updateParameter(StoreKey.LastExecutedMessageId, '' + id)
  }

  async updateSkip(value: boolean = true, bot?: Bot): Promise<unknown> {
    return this.updateParameter(StoreKey.Skip, value ? 'true' : 'false', bot)
  }

  async updateRange(min: string, max: string, bot?: Bot): Promise<void> {
    await this.updateParameter(StoreKey.MinCollateralRatio, min, bot)
    await this.updateParameter(StoreKey.MaxCollateralRatio, max, bot)
  }

  async updateReinvest(value: string, bot?: Bot): Promise<unknown> {
    const key = this.getKeyForBot(StoreKey.Reinvest, StoreKey.LMRReinvest, bot)
    if (!key) return Promise.reject()
    return this.updateParameter(key, value, bot)
  }

  async updateReinvestPattern(value: string, bot?: Bot): Promise<unknown> {
    const key = this.getKeyForBot(StoreKey.ReinvestPattern, StoreKey.LMRReinvestPattern, bot)
    if (!key) return Promise.reject()
    return this.updateParameter(key, value, bot)
  }

  async updateLMPair(value: string, bot?: Bot): Promise<unknown> {
    const key = this.getKeyForBot(StoreKey.LMPair, StoreKey.LMRPair, bot)
    if (!key) return Promise.reject()
    return this.updateParameter(key, value, bot)
  }

  async updateAutoDonation(value: string, bot?: Bot): Promise<unknown> {
    const key = this.getKeyForBot(StoreKey.AutoDonation, StoreKey.LMRAutoDonation, bot)
    if (!key) return Promise.reject()
    return this.updateParameter(key, value, bot)
  }

  async updateStableArbBatchSize(value: string, bot?: Bot): Promise<unknown> {
    return this.updateParameter(StoreKey.StableArbBatchSize, value, bot)
  }

  async fetchSettings(): Promise<StoredSettings> {
    //store only allows to get 10 parameters per request
    let parameters =
      (
        await this.ssm
          .getParameters({
            Names: [
              StoreKey.TelegramChatId,
              StoreKey.TelegramToken,
              StoreKey.TelegramUserName,
              StoreKey.LastExecutedMessageId,
            ],
          })
          .promise()
      ).Parameters ?? []

    parameters.push(...((await this.ssm.getParameters({ Names: this.stateParameters }).promise()).Parameters ?? []))

    this.settings.chatId = this.getValue(StoreKey.TelegramChatId, parameters)
    this.settings.token = this.getValue(StoreKey.TelegramToken, parameters)
    this.settings.username = this.getValue(StoreKey.TelegramUserName, parameters)
    this.settings.lastExecutedMessageId = this.getNumberValue(StoreKey.LastExecutedMessageId, parameters)

    this.settings.states = parameters
      .filter((p) => {
        return this.stateParameters.includes(p.Name ?? '')
      })
      .map((state) => {
        const stateParameter = state.Name ?? ''
        const stateValue = this.getValue(stateParameter, parameters)
        const bot = stateParameter.includes('-reinvest') ? BotType.REINVEST : BotType.MAXI
        const parts = stateParameter.split('/')
        let name = parts[1]
        switch (bot) {
          case BotType.MAXI:
            name = name.replace('defichain-maxi', VAULT_MAXI)
            break
          case BotType.REINVEST:
            name = name.replace('defichain-maxi', LM_REINVEST)
            break
        }
        return {
          bot,
          name,
          stateParameter,
          stateValue,
        }
      })

    return this.settings
  }

  private async updateParameter(key: StoreKey, value: string, bot?: Bot): Promise<unknown> {
    const newValue = {
      Name: this.extendKey(key, bot),
      Value: value,
      Overwrite: true,
      Type: 'String',
    }
    return this.ssm.putParameter(newValue).promise()
  }

  private getValue(key: string, parameters: SSM.ParameterList): string {
    return (parameters?.find((element) => element.Name === key)?.Value as string).trim()
  }

  private getNumberValue(key: string, parameters: SSM.ParameterList): number | undefined {
    let value = parameters?.find((element) => element.Name === key)?.Value
    return value ? +value : undefined
  }

  private extendKey(key: StoreKey, bot?: Bot): string {
    if (!bot) return key
    return key.replace('-maxi', '-maxi' + bot?.postfix)
  }

  private getKeyForBot(maxi: StoreKey, reinvest: StoreKey, bot?: Bot): StoreKey | undefined {
    switch (bot?.type) {
      case BotType.MAXI:
        return maxi
      case BotType.REINVEST:
        return reinvest
      default:
        return undefined
    }
  }
}

enum StoreKey {
  // defichain-maxi related keys
  Skip = '/defichain-maxi/skip',
  MaxCollateralRatio = '/defichain-maxi/settings/max-collateral-ratio',
  MinCollateralRatio = '/defichain-maxi/settings/min-collateral-ratio',
  LMPair = '/defichain-maxi/settings/lm-pair',
  Reinvest = '/defichain-maxi/settings/reinvest',
  ReinvestPattern = '/defichain-maxi/settings/reinvest-pattern',
  AutoDonation = '/defichain-maxi/settings/auto-donation-percent-of-reinvest',
  StableArbBatchSize = '/defichain-maxi/settings/stable-arb-batch-size',

  // defichain-maxi lm-reinvest related keys
  LMRPair = '/defichain-maxi/settings-reinvest/lm-pair',
  LMRReinvest = '/defichain-maxi/settings-reinvest/reinvest',
  LMRReinvestPattern = '/defichain-maxi/settings-reinvest/pattern',
  LMRAutoDonation = '/defichain-maxi/settings-reinvest/auto-donation-percent-of-reinvest',

  // command center related keys
  TelegramChatId = '/defichain-maxi/command-center/telegram/chat-id',
  TelegramToken = '/defichain-maxi/command-center/telegram/token',
  TelegramUserName = '/defichain-maxi/command-center/telegram/username',
  LastExecutedMessageId = '/defichain-maxi/command-center/last-executed-message-id',
}

export interface StoredState {
  bot: BotType
  name: string
  stateParameter: string
  stateValue: string
}

export class StoredSettings {
  chatId: string = ''
  token: string = ''
  lastExecutedMessageId: number | undefined
  username: string = ''
  states: StoredState[] = []
}
