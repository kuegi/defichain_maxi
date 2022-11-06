import { ProgramState } from '../programs/common-program'
import { ProgramStateInformation } from './program-state-converter'
import { StoreConfig } from './store_config'

export class StoredSettings {
  address: string = ''
  vault: string = ''
  seed: string[] = []
}

export interface IStore {}


