import { StoredSettings } from './store'
import { Telegram } from './telegram'

const regexToken = /[0-9]{10}:.*/
const regexChatId = /-?[0-9]+/

export class SetupCheck {
  static async with(settings: StoredSettings, telegram: Telegram): Promise<void> {
    const isTokenValid = regexToken.test(settings.token)
    const isChatIdValid = regexChatId.test(settings.chatId)

    const message =
      'Check-setup result\n' +
      `Telegram bot token is ${settings.token ? (isTokenValid ? 'valid' : 'not valid') : 'does not exist'}\n` +
      `Telegram chat id is ${settings.chatId ? (isChatIdValid ? 'valid' : 'not valid') : 'does not exist'}\n` +
      `Only messages from ${settings.username ? settings.username : '-no username found-'} are allowed\n` +
      `Did already run once? ${settings.lastExecutedMessageId && settings.lastExecutedMessageId > 0 ? 'Yes' : 'No'}`

    console.log(message)
    await telegram.send(message)
  }
}
