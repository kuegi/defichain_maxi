import fetch from 'cross-fetch'
import { CommandInfo } from '../commands/command'
import { BotType, LM_REINVEST, VAULT_MAXI } from './available-bot'
import { StoredSettings } from './store'
import { Message } from './telegram'

export interface Poolpair {
  symbol: string
}

export const oceanURL = process.env.VAULTMAXI_OCEAN_URL ?? 'https://ocean.defichain.com'

export function isNullOrEmpty(value: string): boolean {
  return value === undefined || value.length === 0
}

export function checkSafetyOf(message: Message, settings: StoredSettings): boolean {
  let lastExecutedMessageId = settings.lastExecutedMessageId ?? 0
  let username = settings.username.startsWith('@') ? settings.username.split('@')[1] : settings.username
  return (
    message.id > lastExecutedMessageId && // only execute new messages
    message.username === username && // only messages of the configured user
    message.chat_id === settings.chatId && // only from configured chat
    !message.is_bot
  ) // message should not come from a bot
}

export function isNumber(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return !isNaN(Number(value))
}

export function extendForListOfPoolPairs(url: string): string {
  return url + '/v0/mainnet/poolpairs?size=1000'
}

export async function fetchListOfPoolPairs(): Promise<string[]> {
  const response = await fetch(extendForListOfPoolPairs(oceanURL))
  const json = await response.json()
  const poolpairs = json['data'] as Poolpair[]
  return poolpairs.map((poolpair) => {
    return poolpair.symbol
  })
}

export function multiBotDescriptionFor(
  bots: BotType[],
  maxi: CommandInfo,
  reinvest: CommandInfo,
  usageInfo?: CommandInfo,
): string | undefined {
  if (bots.includes(BotType.MAXI) && bots.includes(BotType.REINVEST) && usageInfo)
    return usageInfo.description + '\n' + maxi.usage + '\n' + reinvest.usage
  if (bots.includes(BotType.MAXI) && bots.includes(BotType.REINVEST))
    return maxi.usage + '\n' + maxi.description + '\n' + reinvest.usage + '\n' + reinvest.description
  if ((bots.includes(BotType.MAXI) || bots.includes(BotType.REINVEST)) && usageInfo)
    return usageInfo.description + '\n' + usageInfo.usage
  if (bots.includes(BotType.MAXI)) return maxi.description
  if (bots.includes(BotType.REINVEST)) return reinvest.description
  return undefined
}
