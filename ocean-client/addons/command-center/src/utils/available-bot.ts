import { StoredSettings } from './store'
import { VersionCheck } from './version-check'

export enum Bot {
  MAXI = 'vault-maxi',
  REINVEST = 'lm-reinvest',
}

export interface BotData {
  name: string
  version: string
  lastBlock: number
}

export type BotInformation = [Bot, BotData]

export class AvailableBots {
  private bots: BotInformation[]

  constructor(settings: StoredSettings) {
    this.bots = []
    const vaultMaxi = AvailableBots.parseVaultMaxi(settings.state)
    if (vaultMaxi) this.bots.push([Bot.MAXI, vaultMaxi])
    const lmReinvest = AvailableBots.parseLMReinvest(settings.reinvest)
    if (lmReinvest) this.bots.push([Bot.REINVEST, lmReinvest])
  }

  private static parseVaultMaxi(state?: string): BotData | undefined {
    if (!state) return undefined
    return this.parseBot('maxi', state)
  }

  private static parseLMReinvest(reinvest?: { state: string }): BotData | undefined {
    if (!reinvest || !reinvest.state) return undefined
    return this.parseBot('lm-r', reinvest.state)
  }

  private static parseBot(name: string, state: string): BotData | undefined {
    const components = state.split('|')
    if (components.length < 5) return undefined
    return {
      name: name,
      version: VersionCheck.extractJoinedVersion(state),
      lastBlock: +components[3],
    }
  }

  list(): BotInformation[] {
    return this.bots
  }

  getBots(): Bot[] {
    return this.bots.map((info) => {
      return info[0]
    })
  }

  isAvailable(bot: Bot): boolean {
    return this.getBots().includes(bot)
  }
}
