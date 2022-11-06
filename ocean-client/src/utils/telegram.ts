import fetch from 'cross-fetch'
import { isNullOrEmpty } from './helpers'

export interface TelegramSettings {
  chatId: string
  token: string
  logChatId: string
  logToken: string
}

export class Telegram {
  private readonly prefix: string = '[VaultMaxi]'
  readonly chatId: string = ''
  readonly token: string = ''
  readonly logChatId: string = ''
  readonly logToken: string = ''
  private readonly endpoint: string = 'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message'

  constructor(settings: TelegramSettings, prefix: string = '') {
    this.logChatId = settings.logChatId
    this.logToken = settings.logToken
    this.token = settings.token
    this.chatId = settings.chatId
    this.prefix = prefix
  }

  async send(message: string): Promise<unknown> {
    if (isNullOrEmpty(this.chatId) || isNullOrEmpty(this.token)) {
      return
    }
    return this.internalSend(message, this.chatId, this.token)
  }

  async log(message: string): Promise<unknown> {
    if (isNullOrEmpty(this.logChatId) || isNullOrEmpty(this.logToken)) {
      return
    }
    return this.internalSend(message, this.logChatId, this.logToken)
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
