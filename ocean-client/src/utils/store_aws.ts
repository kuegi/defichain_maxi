import SSM from 'aws-sdk/clients/ssm'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'

// handle AWS Paramter
export class StoreAWS implements IStore {
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

    async skipNext(): Promise<void> {
        const key = StoreKey.Skip.replace("-maxi", "-maxi" + this.settings.paramPostFix)
        await this.ssm.putParameter({
            Name: key,
            Value: "true",
            Overwrite: true,
            Type: 'String'
        }).promise()
    }

    async clearSkip(): Promise<void> {
        const key = this.postfixedKey(StoreKey.Skip)
        await this.ssm.putParameter({
            Name: key,
            Value: "false",
            Overwrite: true,
            Type: 'String'
        }).promise()
    }

    postfixedKey(param : string): string {
        return param.replace("-maxi", "-maxi" + this.settings.paramPostFix)
    }

    async fetchSettings(): Promise<StoredSettings> {
        // first check environment

        let storePostfix = process.env.VAULTMAXI_STORE_POSTFIX ?? (process.env.VAULTMAXI_STORE_POSTIX ?? "")

        this.settings.paramPostFix = storePostfix
        let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

        let DeFiAddressKey = this.postfixedKey(StoreKey.DeFiAddress)
        let DeFiVaultKey = this.postfixedKey(StoreKey.DeFiVault)
        let MinCollateralRatioKey = this.postfixedKey(StoreKey.MinCollateralRatio)
        let MaxCollateralRatioKey = this.postfixedKey(StoreKey.MaxCollateralRatio)
        let ReinvestThreshold = this.postfixedKey(StoreKey.ReinvestThreshold)
        let AutoDonationPercentOfReinvestKey = this.postfixedKey(StoreKey.AutoDonationPercentOfReinvest)
        let LMTokenKey = this.postfixedKey(StoreKey.LMToken)
        let LMPairKey = this.postfixedKey(StoreKey.LMPair)
        let MainCollAssetKey = this.postfixedKey(StoreKey.MainCollateralAsset)
        let StateKey = this.postfixedKey(StoreKey.State)
        let SkipKey = this.postfixedKey(StoreKey.Skip)
        let StableArbBatchSizeKey = this.postfixedKey(StoreKey.StableArbBatchSize)

        let HeartBeatKey = this.postfixedKey(StoreKey.HeartBeatURL)

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names: [
                StoreKey.TelegramNotificationChatId,
                StoreKey.TelegramNotificationToken,
                StoreKey.TelegramLogsChatId,
                StoreKey.TelegramLogsToken,
                SkipKey,
                StableArbBatchSizeKey,
                HeartBeatKey,
            ]
        }).promise()).Parameters ?? []


        parameters = parameters.concat((await this.ssm.getParameters({
            Names: [DeFiAddressKey,
                DeFiVaultKey,
                MinCollateralRatioKey,
                MaxCollateralRatioKey,
                LMTokenKey,
                LMPairKey,
                MainCollAssetKey,
                StateKey,
                ReinvestThreshold,
                AutoDonationPercentOfReinvestKey,
            ]
        }).promise()).Parameters ?? [])

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
        this.settings.vault = this.getValue(DeFiVaultKey, parameters)
        this.settings.minCollateralRatio = this.getNumberValue(MinCollateralRatioKey, parameters) ?? this.settings.minCollateralRatio
        this.settings.maxCollateralRatio = this.getNumberValue(MaxCollateralRatioKey, parameters) ?? this.settings.maxCollateralRatio
        let lmPair = this.getOptionalValue(LMPairKey, parameters)
        if (lmPair == undefined) {
            lmPair = this.getValue(LMTokenKey, parameters) + "-DUSD"
        }
        this.settings.LMPair = lmPair
        this.settings.mainCollateralAsset = this.getOptionalValue(MainCollAssetKey, parameters) ?? "DFI"
        this.settings.reinvestThreshold = this.getNumberValue(ReinvestThreshold, parameters)
        this.settings.autoDonationPercentOfReinvest = this.getNumberValue(AutoDonationPercentOfReinvestKey, parameters) ?? this.settings.autoDonationPercentOfReinvest
        this.settings.stateInformation = ProgramStateConverter.fromValue(this.getValue(StateKey, parameters))
        this.settings.stableCoinArbBatchSize = this.getNumberValue(StableArbBatchSizeKey, parameters) ?? -1
        this.settings.shouldSkipNext = (this.getValue(SkipKey, parameters) ?? "false") === "true"

        //optionals
        this.settings.heartBeatUrl = this.getOptionalValue(HeartBeatKey, parameters)

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

  DeFiAddress = '/defichain-maxi/wallet/address',
  DeFiVault = '/defichain-maxi/wallet/vault',
  DeFiWalletSeed = '/defichain-maxi/wallet/seed',

  MinCollateralRatio = '/defichain-maxi/settings/min-collateral-ratio',
  MaxCollateralRatio = '/defichain-maxi/settings/max-collateral-ratio',
  LMToken = '/defichain-maxi/settings/lm-token',
  LMPair = '/defichain-maxi/settings/lm-pair',
  MainCollateralAsset = '/defichain-maxi/settings/main-collateral-asset',
  ReinvestThreshold = '/defichain-maxi/settings/reinvest',
  StableArbBatchSize = '/defichain-maxi/settings/stable-arb-batch-size',
  AutoDonationPercentOfReinvest = '/defichain-maxi/settings/auto-donation-percent-of-reinvest',

  //optionals
  HeartBeatURL = '/defichain-maxi/settings/heartbeat-url',

  State = '/defichain-maxi/state',
  Skip = '/defichain-maxi/skip',
}
