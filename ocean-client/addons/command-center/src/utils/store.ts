import SSM from 'aws-sdk/clients/ssm'

// handle AWS Paramter
export class Store {
    private ssm: SSM
    private postfix: string
    readonly settings: StoredSettings

    constructor() {
        this.ssm = new SSM()
        this.postfix = process.env.VAULTMAXI_STORE_POSTFIX ?? process.env.VAULTMAXI_STORE_POSTIX ?? ""
        this.settings = new StoredSettings()
    }

    async updateExecutedMessageId(id: number): Promise<unknown> {
        return this.updateParameter(StoreKey.LastExecutedMessageId, "" + id)
    }

    async updateSkip(value: boolean = true): Promise<unknown> {
        return this.updateParameter(StoreKey.Skip, value ? "true" : "false")
    }

    async updateRange(min: string, max: string): Promise<void> {
        await this.updateParameter(StoreKey.MinCollateralRatio, min)
        await this.updateParameter(StoreKey.MaxCollateralRatio, max)
    }

    async updateReinvest(value: string): Promise<unknown> {
        return this.updateParameter(StoreKey.Reinvest, value)
    }

    async updateToken(value: string): Promise<unknown> {
        return this.updateParameter(StoreKey.LMToken, value)
    }

    async fetchSettings(): Promise<StoredSettings> {

        let TelegramNotificationChatIdKey = this.extendKey(StoreKey.TelegramChatId)
        let TelegramNotificationTokenKey = this.extendKey(StoreKey.TelegramToken)
        let TelegramUserName = this.extendKey(StoreKey.TelegramUserName)
        let LastExecutedMessageIdKey = this.extendKey(StoreKey.LastExecutedMessageId)
        let StateKey = this.extendKey(StoreKey.State)
        let LMTokenKey = this.extendKey(StoreKey.LMToken)

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names: [
                TelegramNotificationChatIdKey,
                TelegramNotificationTokenKey,
                TelegramUserName,
                LastExecutedMessageIdKey,
                StateKey,
                LMTokenKey,
            ]
        }).promise()).Parameters ?? []

        this.settings.chatId = this.getValue(TelegramNotificationChatIdKey, parameters)
        this.settings.token = this.getValue(TelegramNotificationTokenKey, parameters)
        this.settings.username = this.getValue(TelegramUserName, parameters)
        this.settings.lastExecutedMessageId = this.getNumberValue(LastExecutedMessageIdKey, parameters)
        this.settings.state = this.getValue(StateKey, parameters)
        this.settings.LMToken = this.getValue(LMTokenKey, parameters)

        return this.settings
    }

    private async updateParameter(key: StoreKey, value: string): Promise<unknown> {
        const newValue = {
            Name: this.extendKey(key),
            Value: value,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(newValue).promise()
    }

    private getValue(key: string, parameters: SSM.ParameterList): string {
        return parameters?.find(element => element.Name === key)?.Value as string
    }

    private getNumberValue(key: string, parameters: SSM.ParameterList): number | undefined {
        let value = parameters?.find(element => element.Name === key)?.Value
        return value ? +value : undefined
    }

    private getBooleanValue(key: string, parameters: SSM.ParameterList): boolean | undefined {
        let value = parameters?.find(element => element.Name === key)?.Value
        return value ? JSON.parse(value) : undefined
    }

    private extendKey(key: StoreKey): string {
        return key.replace("-maxi", "-maxi" + this.postfix)
    }
}

enum StoreKey {
    // defichain-maxi related keys
    Skip = '/defichain-maxi/skip',
    State = '/defichain-maxi/state',
    MaxCollateralRatio = '/defichain-maxi/settings/max-collateral-ratio',
    MinCollateralRatio = '/defichain-maxi/settings/min-collateral-ratio',
    LMToken = '/defichain-maxi/settings/lm-token',
    Reinvest = '/defichain-maxi/settings/reinvest',

    // command center related keys
    TelegramChatId = '/defichain-maxi/command-center/telegram/chat-id',
    TelegramToken = '/defichain-maxi/command-center/telegram/token',
    TelegramUserName = '/defichain-maxi/command-center/telegram/username',
    LastExecutedMessageId = '/defichain-maxi/command-center/last-executed-message-id',
}

export class StoredSettings {
    chatId: string = ""
    token: string = ""
    lastExecutedMessageId: number|undefined
    username: string = ""
    state: string = ""
    LMToken: string = ""
}
