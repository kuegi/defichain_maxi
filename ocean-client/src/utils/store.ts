import SSM from 'aws-sdk/clients/ssm'

export class Store {
    private ssm = new SSM()
    readonly settings: StoredSettings

    constructor() {
        this.settings = new StoredSettings()
    }

    async fetchSettings(): Promise<StoredSettings> {
        let keys = [
            StoreKey.TelegramNotificationChatId,
            StoreKey.TelegramNotificationToken,
            StoreKey.TelegramLogsChatId,
            StoreKey.TelegramLogsToken,
            StoreKey.DeFiAddress,
            StoreKey.DeFiVault,
        ]
        const result = await this.ssm.getParameters({
            Names: keys
        }).promise()

        const decryptedSeed = await this.ssm.getParameter({
            Name: StoreKey.DeFiWalletSeed,
            WithDecryption: true
        }).promise()

        let parameters = result.Parameters ?? []
        this.settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
        this.settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
        this.settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
        this.settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
        this.settings.address = this.getValue(StoreKey.DeFiAddress, parameters)
        this.settings.vault = this.getValue(StoreKey.DeFiVault, parameters)
        this.settings.seed = decryptedSeed.Parameter?.Value?.split(',') ?? []
        return this.settings
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
    vault: string = ""
    seed: string[] = []
}

enum StoreKey {
    TelegramNotificationChatId = '/ocean-client/telegram/notifications/chat-id',
    TelegramNotificationToken = '/ocean-client/telegram/notifications/token',
    TelegramLogsChatId = '/ocean-client/telegram/logs/chat-id',
    TelegramLogsToken = '/ocean-client/telegram/logs/token',
    DeFiAddress = '/ocean-client/wallet/light/address',
    DeFiVault = '/ocean-client/wallet/light/vault',
    DeFiWalletSeed = '/ocean-client/wallet/light/seed',
}