import SSM from 'aws-sdk/clients/ssm'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'

// handle AWS Paramter
export class StoreAWSTestnetBot implements IStore {
    private ssm: SSM
    readonly settings: StoredSettings

    constructor() {
        this.ssm = new SSM()
        this.settings = new StoredSettings()
    }

    async updateToState(information: ProgramStateInformation): Promise<void> { }

    async skipNext(): Promise<void> { }
    async clearSkip(): Promise<void> { }

    async fetchSettings(): Promise<StoredSettings> {
        // first check environment

        let seedkey = process.env.DEFICHAIN_SEED_KEY ?? StoreKey.DeFiWalletSeed

        let DeFiAddressKey = StoreKey.DeFiAddress
        let StateKey = StoreKey.State

        //store only allows to get 10 parameters per request
        let parameters = (await this.ssm.getParameters({
            Names: [
                StoreKey.TelegramLogsChatId,
                StoreKey.TelegramLogsToken,
                DeFiAddressKey,
                StateKey
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
        this.settings.token = this.getValue(StoreKey.TelegramLogsChatId, parameters)
        this.settings.chatId = this.getValue(StoreKey.TelegramLogsToken, parameters)
        this.settings.address = this.getValue(DeFiAddressKey, parameters)
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
    TelegramLogsChatId = '/defichain-maxi/telegram/notifications/chat-id',
    TelegramLogsToken = '/defichain-maxi/telegram/notifications/token',

    DeFiAddress = '/defichain-maxi/wallet/address',
    DeFiWalletSeed = '/defichain-maxi/wallet/seed',

    State = '/defichain-maxi/state',
}
