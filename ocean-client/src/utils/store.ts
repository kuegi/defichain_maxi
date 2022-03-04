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
            StoreKey.MinCollateralRatio,
            StoreKey.MaxCollateralRatio,
            StoreKey.LMToken,
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
        if((decryptedSeed.Parameter?.Value?.indexOf(",") ?? -1) > 0) {
            this.settings.seed = decryptedSeed.Parameter?.Value?.split(',') ?? []
        } else {
            this.settings.seed = decryptedSeed.Parameter?.Value?.split(' ') ?? []
        }
        this.settings.LMToken = this.getValue(StoreKey.LMToken, parameters)
        var minCollateralRatio = this.getNumberValue(StoreKey.MinCollateralRatio, parameters)
        if (minCollateralRatio) {
            this.settings.minCollateralRatio = minCollateralRatio
        }
        var maxCollateralRatio = this.getNumberValue(StoreKey.MaxCollateralRatio, parameters)
        if (maxCollateralRatio) {
            this.settings.maxCollateralRatio = maxCollateralRatio
        }
        // 2022-03-04 Krysh: TODO add clean up variable
        return this.settings
    }

    private getValue(key: StoreKey, parameters: SSM.ParameterList): string {
        return parameters?.find(element => element.Name === key)?.Value as string
    }

    private getNumberValue(key: StoreKey, parameters: SSM.ParameterList): number | undefined {
        let value = parameters?.find(element => element.Name === key)?.Value
        return value ? parseInt(value) : undefined
    }

    private getBooleanValue(key: StoreKey, parameters: SSM.ParameterList): boolean | undefined {
        let value = parameters?.find(element => element.Name === key)?.Value
        return value ? JSON.parse(value) : undefined
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
    minCollateralRatio: number = 200
    maxCollateralRatio: number = 250
    LMToken: string = "GLD"
    shouldCleanUp: boolean = false
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
    CleanUp = '/defichain-maxi/settings/clean-up'
}