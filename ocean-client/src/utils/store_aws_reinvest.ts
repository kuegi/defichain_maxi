import SSM from 'aws-sdk/clients/ssm'
import { ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'

// handle AWS Paramter
export class StoreAWSReinvest implements IStore {
    private ssm: SSM
    readonly settings: StoredSettings

    constructor() {
        this.ssm = new SSM()
        this.settings = new StoredSettings()
    }

    async updateToState(information: ProgramStateInformation): Promise<void> {
        const key = StoreKey.State.replace("-maxi", "-maxi" + this.settings.paramPostFix)
        const state = {
            Name: key,
            Value: ProgramStateConverter.toValue(information),
            Overwrite: true,
            Type: 'String'
        }
        await this.ssm.putParameter(state).promise()
    }

    async skipNext(): Promise<void> { }
    async clearSkip(): Promise<void> { }

    async fetchSettings(): Promise<StoredSettings> {
        // first check environment

        let storePostfix = process.env.VAULTMAXI_STORE_POSTFIX ?? (process.env.VAULTMAXI_STORE_POSTIX ?? "")

        this.settings.paramPostFix = storePostfix
        let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

        let DeFiAddressKey = StoreKey.DeFiAddress.replace("-maxi", "-maxi" + storePostfix)
        let ReinvestThreshold = StoreKey.ReinvestThreshold.replace("-maxi", "-maxi" + storePostfix)
        let AutoDonationPercentOfReinvestKey = StoreKey.AutoDonationPercentOfReinvest.replace("-maxi", "-maxi" + storePostfix)
        let LMPairKey = StoreKey.LMPair.replace("-maxi", "-maxi" + storePostfix)
        let StateKey = StoreKey.State.replace("-maxi", "-maxi" + storePostfix)

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names: [
                StoreKey.TelegramNotificationChatId,
                StoreKey.TelegramNotificationToken,
                StoreKey.TelegramLogsChatId,
                StoreKey.TelegramLogsToken,
                DeFiAddressKey,
                LMPairKey,
                ReinvestThreshold,
                AutoDonationPercentOfReinvestKey,
                StateKey,
            ]
        }).promise()).Parameters ?? []

        let decryptedSeed
        try {
            decryptedSeed = await this.ssm.getParameter({
                Name: seedkey,
                WithDecryption: true
            }).promise()
        } catch (e) {
            console.error("Seed Parameter not found!")
            decryptedSeed = undefined
        }
        this.settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
        this.settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
        this.settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
        this.settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
        this.settings.address = this.getValue(DeFiAddressKey, parameters)
        this.settings.LMPair = this.getValue(LMPairKey, parameters)
        this.settings.reinvestThreshold = this.getNumberValue(ReinvestThreshold, parameters)
        this.settings.autoDonationPercentOfReinvest = this.getNumberValue(AutoDonationPercentOfReinvestKey, parameters) ?? this.settings.autoDonationPercentOfReinvest
        this.settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))

        let seedList = decryptedSeed?.Parameter?.Value?.replace(/[ ,]+/g, " ")
        this.settings.seed = seedList?.trim().split(' ') ?? []
        return this.settings
    }

    private getValue(key: string, parameters: SSM.ParameterList): string {
        return parameters?.find(element => element.Name === key)?.Value as string
    }

    private getOptionalValue(key: string, parameters: SSM.ParameterList): string | undefined {
        return parameters?.find(element => element.Name === key)?.Value
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
    TelegramNotificationChatId = '/defichain-maxi/telegram/notifications/chat-id',
    TelegramNotificationToken = '/defichain-maxi/telegram/notifications/token',
    TelegramLogsChatId = '/defichain-maxi/telegram/logs/chat-id',
    TelegramLogsToken = '/defichain-maxi/telegram/logs/token',

    DeFiAddress = '/defichain-maxi/wallet-reinvest/address',
    DeFiWalletSeed = '/defichain-maxi/wallet/seed',

    LMPair = '/defichain-maxi/settings-reinvest/lm-pair',
    ReinvestThreshold = '/defichain-maxi/settings-reinvest/reinvest',
    AutoDonationPercentOfReinvest = '/defichain-maxi/settings-reinvest/auto-donation-percent-of-reinvest',

    State = '/defichain-maxi/state-reinvest',

}
