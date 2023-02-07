import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IReinvestSettings } from './reinvestor'
import { IStore, StoredSettings } from './store'
import fs from 'fs'
import { IStoreMaxi, StoredMaxiSettings } from './store_aws_maxi'
import { LogLevel, logLevelFromParam, TelegramSettings } from './telegram'

// handle Parameter in local config on Linux and Windows
export class StoreConfig implements IStoreMaxi {
  readonly paramPostFix: string = ''
  readonly settings: StoredMaxiSettings
  private config: ConfigFile
  private configpath: string
  private statefile: string

  constructor() {
    this.settings = new StoredMaxiSettings()
    this.paramPostFix = process.env.VAULTMAXI_STORE_POSTIX ?? ''
    // get home dir on Linux or Windows
    this.configpath = process.env.HOME ?? process.env.USERPROFILE ?? ''
    if (!this.configpath) throw new Error('Can not get Home folder')
    // set maxi config & state folder
    this.configpath += '/.vault-maxi'
    // create dir if not exist
    if (!fs.existsSync(this.configpath)) fs.mkdirSync(this.configpath)
    this.statefile = this.configpath + `/state${this.paramPostFix}.txt`
    this.config = this.GetConfig()
    if (!fs.existsSync(this.config.seedfile)) throw new Error(`seedfile ${this.config.seedfile} not exists!`)
  }

  private GetConfig(): ConfigFile {
    var configfile = this.configpath + `/settings${this.paramPostFix}.json`
    if (!fs.existsSync(configfile)) {
      // write empty config if not exists
      fs.writeFileSync(configfile, JSON.stringify(new ConfigFile(), null, 2))
      throw new Error(
        `new empty config created: ${configfile}. Enter your values before the next start. Set seedfile to an encrypted folder.`,
      )
    }
    const result = require(configfile) // read config
    return result
  }

  async skipNext(): Promise<void> {
    console.error('skipNext not implemented on config version')
  }

  async clearSkip(): Promise<void> {
    console.error('clearSkip not implemented on config version')
  }

  async updateToState(information: ProgramStateInformation): Promise<void> {
    fs.writeFileSync(this.statefile, ProgramStateConverter.toValue(information))
  }

  // Get first line of text file. Or empty string on error.
  private GetFirstLine(file: string): string {
    if (!fs.existsSync(file)) return ''
    var lines = fs.readFileSync(file).toString().split('\n')
    if (lines.length == 0) return ''
    return lines[0]
  }

  async fetchSettings(): Promise<StoredMaxiSettings> {
    let logId = this.config.logId
    if (logId != "") {
      this.settings.logId = this.config.logId
    }
    this.settings.chatId = this.config.chatId
    this.settings.token = this.config.token
    this.settings.logChatId = this.config.logChatId
    this.settings.logToken = this.config.logToken
    this.settings.address = this.config.address
    this.settings.vault = this.config.vault
    this.settings.minCollateralRatio = this.config.minCollateralRatio
    this.settings.maxCollateralRatio = this.config.maxCollateralRatio
    let lmPair = this.config.LMPair
    if (lmPair == undefined) {
      lmPair = this.config.LMToken + '-DUSD'
    }
    this.settings.LMPair = lmPair
    this.settings.mainCollateralAsset = this.config.mainCollateralAsset
    this.settings.reinvestThreshold = this.config.reinvestThreshold
    this.settings.reinvestPattern = this.config.reinvestPattern
    this.settings.stableCoinArbBatchSize = this.config.stableArbBatchSize ?? -1
    this.settings.stateInformation = ProgramStateConverter.fromValue(this.GetFirstLine(this.statefile))
    let seedList = this.GetFirstLine(this.config.seedfile).replace(/[ ,]+/g, ' ')
    this.settings.seed = seedList?.trim().split(' ') ?? []
    this.settings.autoDonationPercentOfReinvest = this.config.AutoDonationPercent
    this.settings.oceanUrl = this.config.oceanUrl
    this.settings.logLevel = logLevelFromParam(this.config.logLevel)
    return this.settings
  }
}

class ConfigFile {
  logId: string = ''
  chatId: string = ''
  token: string = ''
  logChatId: string = ''
  logToken: string = ''
  address: string = ''
  vault: string = ''
  seedfile: string = 'V:/store/vault-maxi-seed.txt'
  minCollateralRatio: number = 200
  maxCollateralRatio: number = 250
  LMToken: string | undefined
  LMPair: string = 'GLD-DUSD'
  mainCollateralAsset: string = 'DFI'
  reinvestThreshold: number | undefined = 0
  reinvestPattern: string = 'DFI'
  stableArbBatchSize: number | undefined = -1
  AutoDonationPercent: number = 0
  oceanUrl: string = ''
  logLevel: string = 'INFO'
}
