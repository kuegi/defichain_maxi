import { ProgramState } from '../programs/common-program'
import { PoolStateInformation } from './pool-state-converter';
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { StoreAWS } from './store_aws'
import { StoreConfig } from './store_config'

export interface IStore {
    readonly settings: StoredSettings;
    updateToState(information: ProgramStateInformation): Promise<void>;
    updateToPoolState(information: PoolStateInformation): Promise<void>;
    fetchSettings(): Promise<StoredSettings>;
}

export class Store {

    public get settings(): StoredSettings {
        return this.storeprovider.settings;
    }

    private storeprovider: IStore;


    constructor() {
        var aws_execution_env = process.env.AWS_EXECUTION_ENV
        if (process.env.LOG_ENV == 'TRUE') console.log(process.env)
        if (aws_execution_env) {
            this.storeprovider = new StoreAWS();
        } else {
            this.storeprovider = new StoreConfig();
        }
    }

    async updateToState(information: ProgramStateInformation): Promise<void> {
        await this.storeprovider.updateToState(information)
    }

    async updateToPoolState(information: PoolStateInformation): Promise<void> {
        await this.storeprovider.updateToPoolState(information)
    }

    async fetchSettings(): Promise<StoredSettings> {
        return await this.storeprovider.fetchSettings()
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
    stateInformation: ProgramStateInformation = { state: ProgramState.Idle, tx: '', txId: '', blockHeight: 0 }
    moveToTreshold: number | undefined
    moveToAddress: string = ""
    poolInformation: PoolStateInformation = {pool : '', blockHeight: 0, tx: '', txId: ''}
    switchPoolInBlocks: number | undefined
}
