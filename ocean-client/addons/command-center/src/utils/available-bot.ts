import { StoredSettings, StoredState } from './store'
import { VersionCheck } from './version-check'

export const VAULT_MAXI = 'defichain-vault-maxi'
export const LM_REINVEST = 'defichain-lm-reinvest'

export enum BotType {
  MAXI = 'vault-maxi',
  REINVEST = 'lm-reinvest',
}

export interface Bot {
  name: string
  postfix: string
  type: BotType
  version: string
  lastBlock: number
  isIdle: boolean
}

export type PossibleBot = StoredState

export class AvailableBots {
  private bots: Bot[]

  constructor(settings: StoredSettings) {
    this.bots = []
    settings.states.forEach((state) => {
      const bot = AvailableBots.parseBot(state)
      if (bot) this.bots.push(bot)
    })
  }

  private static parseBot(state: StoredState): Bot | undefined {
    const components = state.stateValue.split('|')
    if (components.length < 5) return undefined
    return {
      name: state.name,
      postfix: state.name.replace(VAULT_MAXI, '').replace(LM_REINVEST, ''),
      type: state.bot,
      version: VersionCheck.extractJoinedVersion(state.stateValue),
      lastBlock: +components[3],
      isIdle: state.stateValue.startsWith('idle'),
    }
  }

  list(): Bot[] {
    return this.bots
  }

  isAvailable(name: string): boolean {
    return (
      this.list().filter((b) => b.name === name).length > 0 ||
      this.list().filter((b) => AvailableBots.shortBotName(b) === name).length > 0
    )
  }

  static shortBotName(bot: Bot): string {
    return bot.name.replace(VAULT_MAXI, 'maxi').replace(LM_REINVEST, 'lm-r')
  }
}
