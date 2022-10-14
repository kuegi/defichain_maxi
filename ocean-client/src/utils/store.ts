import { ProgramState } from '../programs/common-program'
import { ProgramStateInformation } from './program-state-converter'
import { StoreAWS } from './store_aws'
import { StoreConfig } from './store_config'

export interface IStore {
  readonly settings: StoredSettings
  updateToState(information: ProgramStateInformation): Promise<void>
  fetchSettings(): Promise<StoredSettings>
  skipNext(): Promise<void>
  clearSkip(): Promise<void>
}

export class Store implements IStore {
  public get settings(): StoredSettings {
    return this.storeprovider.settings
  }

  private storeprovider: IStore

  constructor() {
    var aws_execution_env = process.env.AWS_EXECUTION_ENV
    if (process.env.LOG_ENV == 'TRUE') console.log(process.env)
    if (aws_execution_env) {
      this.storeprovider = new StoreAWS()
    } else {
      this.storeprovider = new StoreConfig()
    }
  }

  async updateToState(information: ProgramStateInformation): Promise<void> {
    await this.storeprovider.updateToState(information)
  }

  async fetchSettings(): Promise<StoredSettings> {
    return await this.storeprovider.fetchSettings()
  }

  async skipNext(): Promise<void> {
    await this.storeprovider.skipNext()
  }

  async clearSkip(): Promise<void> {
    await this.storeprovider.clearSkip()
  }
}

export class StoredSettings {
  paramPostFix: string = ''
  chatId: string = ''
  token: string = ''
  logChatId: string = ''
  logToken: string = ''
  address: string = ''
  vault: string = ''
  seed: string[] = []
  minCollateralRatio: number = 200
  maxCollateralRatio: number = 250
  LMPair: string = 'GLD-DUSD'
  mainCollateralAsset: string = 'DFI'
  stableCoinArbBatchSize: number = -1
  reinvestThreshold: number | undefined
  autoDonationPercentOfReinvest: number = 0
  stateInformation: ProgramStateInformation = {
    state: ProgramState.Idle,
    tx: '',
    txId: '',
    blockHeight: 0,
    version: undefined,
  }
  shouldSkipNext: boolean = false

  heartBeatUrl: string | undefined
}
