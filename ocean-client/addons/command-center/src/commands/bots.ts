import { getBorderCharacters, table, TableUserConfig } from 'table'
import { AvailableBots, BotType, Bot } from '../utils/available-bot'
import { Store } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { VersionCheck } from '../utils/version-check'
import { Command } from './command'

const compatible = '\u{2705}'
const notCompatible = '\u{274C}'

const config: TableUserConfig = {
  border: getBorderCharacters('ramac'),
  columns: [{ alignment: 'left' }, { alignment: 'center' }, { alignment: 'center' }, { alignment: 'center' }],
}

export class Bots extends Command {
  constructor(telegram: Telegram, store: Store, availableBots: AvailableBots, commandData: string[]) {
    super(telegram, store, availableBots, commandData)
  }

  static descriptionFor(): string {
    return 'Sends you a list of installed bots with version, compatibility check and last execution block'
  }

  listOfBots(): string {
    const data: string[][] = []
    data.push(['bot', 'version', 'block'])
    this.availableBots.list().forEach((info) => {
      data.push(this.rowFor(info))
    })

    return '```' + table(data, config) + '```'
  }

  availableFor(): BotType[] {
    return []
  }

  isInfoCommand(): boolean {
    return true
  }

  doExecution(): Promise<unknown> {
    return this.telegram.send('\n' + this.listOfBots())
  }

  private rowFor(data: Bot): string[] {
    const versionAndCompatibility =
      data.version + ' ' + (VersionCheck.isCompatibleWith(data.name) ? compatible : notCompatible)
    return [AvailableBots.shortBotName(data), versionAndCompatibility, '' + data.lastBlock]
  }
}
