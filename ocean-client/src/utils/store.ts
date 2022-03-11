import SSM from 'aws-sdk/clients/ssm'
import { ProgramState } from '../programs/common-program'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'

export class Store {
    private ssm = new SSM()
    readonly settings: StoredSettings

    constructor() {
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

    async fetchSettings(): Promise<StoredSettings> {
        // first check environment

        let storePostfix = process.env.VAULTMAXI_STORE_POSTIX ?? ""

        this.settings.paramPostFix = storePostfix
        let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

        let DeFiAddressKey = StoreKey.DeFiAddress.replace("-maxi", "-maxi" + storePostfix)
        let DeFiVaultKey = StoreKey.DeFiVault.replace("-maxi", "-maxi" + storePostfix)
        let MinCollateralRatioKey = StoreKey.MinCollateralRatio.replace("-maxi", "-maxi" + storePostfix)
        let MaxCollateralRatioKey = StoreKey.MaxCollateralRatio.replace("-maxi", "-maxi" + storePostfix)
        let ReinvestThreshold = StoreKey.ReinvestThreshold.replace("-maxi", "-maxi" + storePostfix)
        let LMTokenKey = StoreKey.LMToken.replace("-maxi", "-maxi" + storePostfix)
        let StateKey = StoreKey.State.replace("-maxi", "-maxi" + storePostfix)

        let keys = [
            StoreKey.TelegramNotificationChatId,
            StoreKey.TelegramNotificationToken,
            StoreKey.TelegramLogsChatId,
            StoreKey.TelegramLogsToken,
            DeFiAddressKey,
            DeFiVaultKey,
            MinCollateralRatioKey,
            MaxCollateralRatioKey,
            LMTokenKey,
            StateKey,
            ReinvestThreshold,
        ]

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names:  [
                StoreKey.TelegramNotificationChatId,
                StoreKey.TelegramNotificationToken,
                StoreKey.TelegramLogsChatId,
                StoreKey.TelegramLogsToken,
            ]
        }).promise()).Parameters ?? []

    
        parameters= parameters.concat((await this.ssm.getParameters({
            Names:  [DeFiAddressKey,
                DeFiVaultKey,
                MinCollateralRatioKey,
                MaxCollateralRatioKey,
                LMTokenKey,
                StateKey,
                ReinvestThreshold,
            ]
        }).promise()).Parameters ?? [])

        const decryptedSeed = await this.ssm.getParameter({
            Name: seedkey,
            WithDecryption: true
        }).promise()

        this.settings.chatId = this.getValue(StoreKey.TelegramNotificationChatId, parameters)
        this.settings.token = this.getValue(StoreKey.TelegramNotificationToken, parameters)
        this.settings.logChatId = this.getValue(StoreKey.TelegramLogsChatId, parameters)
        this.settings.logToken = this.getValue(StoreKey.TelegramLogsToken, parameters)
        this.settings.address = this.getValue(DeFiAddressKey, parameters)
        this.settings.vault = this.getValue(DeFiVaultKey, parameters)
        this.settings.minCollateralRatio = this.getNumberValue(MinCollateralRatioKey, parameters) ?? this.settings.minCollateralRatio
        this.settings.maxCollateralRatio = this.getNumberValue(MaxCollateralRatioKey, parameters) ?? this.settings.maxCollateralRatio
        this.settings.LMToken = this.getValue(LMTokenKey, parameters)
        this.settings.reinvestThreshold = this.getNumberValue(ReinvestThreshold, parameters)
        this.settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))

        let seedList= decryptedSeed?.Parameter?.Value?.replace(/[ ,]+/g," ")
        this.settings.seed = seedList?.trim().split(' ') ?? []
        return this.settings
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

export class StoredSettings {
    paramPostFix: string = ""
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
    reinvestThreshold: number | undefined 
    stateInformation: ProgramStateInformation= {state: ProgramState.Idle,tx: '',txId: '',blockHeight: 0}
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
    ReinvestThreshold = '/defichain-maxi/settings/reinvest',
    State = '/defichain-maxi/state',
}
