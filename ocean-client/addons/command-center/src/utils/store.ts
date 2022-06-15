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
        const messageId = {
            Name: this.extendKey(StoreKey.LastExecutedMessageId),
            Value: "" + id,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(messageId).promise()
    }

    async updateSkip(): Promise<unknown> {
        const skip = {
            Name: this.extendKey(StoreKey.Skip),
            Value: "true",
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(skip).promise()
    }

    async updateRange(min: string, max: string): Promise<void> {
        await this.updateMinCollateralRatio(min)
        await this.updateMaxCollateralRatio(max)
    }

    async updateReinvest(value: string): Promise<unknown> {
        const reinvest = {
            Name: this.extendKey(StoreKey.Reinvest),
            Value: value,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(reinvest).promise()
    }

    async updateToken(value: string): Promise<unknown> {
        const token = {
            Name: this.extendKey(StoreKey.LMToken),
            Value: value,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(token).promise()
    }

    async fetchSettings(): Promise<StoredSettings> {

        let TelegramNotificationChatIdKey = this.extendKey(StoreKey.TelegramNotificationChatId)
        let TelegramNotificationTokenKey = this.extendKey(StoreKey.TelegramNotificationToken)
        let TelegramUserName = this.extendKey(StoreKey.TelegramUserName)
        let LastExecutedMessageIdKey = this.extendKey(StoreKey.LastExecutedMessageId)
        let StateKey = this.extendKey(StoreKey.State)

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names: [
                TelegramNotificationChatIdKey,
                TelegramNotificationTokenKey,
                TelegramUserName,
                LastExecutedMessageIdKey,
                StateKey,
            ]
        }).promise()).Parameters ?? []

        this.settings.chatId = this.getValue(TelegramNotificationChatIdKey, parameters)
        this.settings.token = this.getValue(TelegramNotificationTokenKey, parameters)
        this.settings.username = this.getValue(TelegramUserName, parameters)
        this.settings.lastExecutedMessageId = this.getNumberValue(LastExecutedMessageIdKey, parameters)
        this.settings.state = this.getValue(StateKey, parameters)

        return this.settings
    }

    private async updateMaxCollateralRatio(ratio: string): Promise<unknown> {
        const maxCollateralRatio = {
            Name: this.extendKey(StoreKey.MaxCollateralRatio),
            Value: ratio,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(maxCollateralRatio).promise()
    }

    private async updateMinCollateralRatio(ratio: string): Promise<unknown> {
        const minCollateralRatio = {
            Name: this.extendKey(StoreKey.MinCollateralRatio),
            Value: ratio,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(minCollateralRatio).promise()
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
    TelegramNotificationChatId = '/defichain-maxi/command-center/telegram/chat-id',
    TelegramNotificationToken = '/defichain-maxi/command-center/telegram/token',
    TelegramUserName = '/defichain-maxi/command-center/telegram/username',
    LastExecutedMessageId = '/defichain-maxi/command-center/last-executed-message-id',
}

export class StoredSettings {
    chatId: string = ""
    token: string = ""
    lastExecutedMessageId: number|undefined
    username: string = ""
    state: string = ""
}
