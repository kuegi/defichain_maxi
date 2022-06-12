import SSM from 'aws-sdk/clients/ssm'

// handle AWS Paramter
export class Store {
    private ssm: SSM
    readonly settings: StoredSettings

    constructor() {
        this.ssm = new SSM()
        this.settings = new StoredSettings()
    }

    async updateExecutedMessageId(id: number): Promise<unknown> {
        const messageId = {
            Name: StoreKey.LastExecutedMessageId,
            Value: "" + id,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(messageId).promise()
    }

    async updateSkip(): Promise<unknown> {
        const skip = {
            Name: StoreKey.Skip,
            Value: "true",
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(skip).promise()
    }

    async removeExposure(): Promise<unknown> {
        return this.updateMaxCollateralRatio("-1")
    }

    async updateRange(min: string, max: string): Promise<void> {
        await this.updateMinCollateralRatio(min)
        await this.updateMaxCollateralRatio(max)
    }

    async fetchSettings(): Promise<StoredSettings> {

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names: [
                StoreKey.TelegramNotificationChatId,
                StoreKey.TelegramNotificationToken,
                StoreKey.LastExecutedMessageId,
            ]
        }).promise()).Parameters ?? []

        this.settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
        this.settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
        this.settings.lastExecutedMessageId = this.getNumberValue(StoreKey.LastExecutedMessageId, parameters)

        return this.settings
    }

    private async updateMaxCollateralRatio(ratio: string): Promise<unknown> {
        const maxCollateralRatio = {
            Name: StoreKey.MaxCollateralRatio,
            Value: ratio,
            Overwrite: true,
            Type: 'String'
        }
        return this.ssm.putParameter(maxCollateralRatio).promise()
    }

    private async updateMinCollateralRatio(ratio: string): Promise<unknown> {
        const minCollateralRatio = {
            Name: StoreKey.MinCollateralRatio,
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
}

enum StoreKey {
    // defichain-maxi related keys
    Skip = '/defichain-maxi/skip',
    MaxCollateralRatio = '/defichain-maxi/settings/max-collateral-ratio',
    MinCollateralRatio = '/defichain-maxi/settings/min-collateral-ratio',
    LMToken = '/defichain-maxi/settings/lm-token',
    Reinvest = '/defichain-maxi/settings/reinvest',

    // command center related keys
    TelegramNotificationChatId = '/defichain-maxi/command-center/telegram/chat-id',
    TelegramNotificationToken = '/defichain-maxi/command-center/telegram/token',
    LastExecutedMessageId = '/defichain-maxi/command-center/last-executed-message-id',
}

export class StoredSettings {
    chatId: string = ""
    token: string = ""
    lastExecutedMessageId: number|undefined
}
