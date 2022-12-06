import fetch from 'cross-fetch'
import { isNull } from 'util'
import { LogLevel } from '../programs/vault-maxi-program'
import { isNullOrEmpty } from './helpers'

export interface TelegramSettings {
  chatId: string
  token: string
  logChatId: string
  logToken: string
  logLevel: LogLevel
}

export class Telegram {
  private readonly prefix: string = '[VaultMaxi]'
  readonly chatId: string = ''
  readonly token: string = ''
  readonly logChatId: string = ''
  readonly logToken: string = ''
  private readonly logLevelInNotifications: LogLevel = LogLevel.INFO
  private readonly endpoint: string = 'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message'

  constructor(settings: TelegramSettings, prefix: string = '') {
    this.logChatId = settings.logChatId
    this.logToken = settings.logToken
    this.token = settings.token
    this.chatId = settings.chatId
    this.prefix = prefix
    this.logLevelInNotifications = settings.logLevel
  }

  async send(message: string, level: LogLevel): Promise<unknown> {
    let chatId = this.chatId
    let token = this.token
    if (level < this.logLevelInNotifications) {
      chatId = this.logChatId
      token = this.logToken
    }
    switch (level) {
      case LogLevel.CRITICAL:
      case LogLevel.ERROR:
        console.error(message)
        break
      case LogLevel.WARNING:
        console.warn(message)
        break
      case LogLevel.INFO:
      case LogLevel.VERBOSE:
        console.log(message)
        break
    }
    if (level == LogLevel.CRITICAL && !isNullOrEmpty(this.logChatId) && !isNullOrEmpty(this.logToken)) {
      //errors get sent to both!
      await this.internalSend(message, this.logChatId, this.logToken)
    }
    if (isNullOrEmpty(chatId) || isNullOrEmpty(token)) {
      if (level == LogLevel.ERROR && !isNullOrEmpty(this.logChatId) && !isNullOrEmpty(this.logToken)) {
        //no notification activated: send error to log
        chatId = this.logChatId
        token = this.logToken
      } else {
        return
      }
    }
    return await this.internalSend(message, chatId, token)
  }

  async internalSend(message: string, chatId: string, token: string, retryCount: number = 0): Promise<void> {
    if (retryCount >= 3) {
      return
    }
    let endpointUrl = this.endpoint
      .replace('%token', token)
      .replace('%chatId', chatId)
      .replace('%message', encodeURI(this.prefix + ' ' + message))

    await fetch(endpointUrl)
      .then((response) => {
        return response.json()
      })
      .catch((e) => {
        console.error('error in telegram send: ' + e)
        this.internalSend(message, chatId, token, retryCount + 1)
      })
    return
  }
}
