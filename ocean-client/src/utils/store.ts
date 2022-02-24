import SSM from 'aws-sdk/clients/ssm'

export class Store {
    private ssm = new SSM()

    async fetchSettings(): Promise<StoredSettings> {
        let keys = [
            StoreKey.TelegramNotificationChatId,
            StoreKey.TelegramNotificationToken,
            StoreKey.TelegramLogsChatId,
            StoreKey.TelegramLogsToken,
            StoreKey.DeFiAddress
        ]
        const result = await this.ssm.getParameters({
            Names: keys
        }).promise()

        const decryptedResult = await this.ssm.getParameter({
            Name: StoreKey.DeFiKey,
            WithDecryption: true
        }).promise()

        let parameters = result.Parameters ?? []
        var settings = new StoredSettings()
        settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
        settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
        settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
        settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
        settings.address = this.getValue(StoreKey.DeFiAddress, parameters)
        settings.key = decryptedResult.Parameter?.Value ?? ""
        return settings
    }

    private getValue(key: StoreKey, parameters: SSM.ParameterList): string {
        return parameters?.find(element => element.Name === key)?.Value as string
    }
}

export class StoredSettings {
    chatId: string = ""
    token: string = ""
    logChatId: string = ""
    logToken: string = ""
    address: string = ""
    key: string = ""
}

enum StoreKey {
    TelegramNotificationChatId = '/ocean-client/telegram/notifications/chat-id',
    TelegramNotificationToken = '/ocean-client/telegram/notifications/token',
    TelegramLogsChatId = '/ocean-client/telegram/logs/chat-id',
    TelegramLogsToken = '/ocean-client/telegram/logs/token',
    DeFiAddress = '/ocean-client/address',
    DeFiKey = '/ocean-client/address/key'
}