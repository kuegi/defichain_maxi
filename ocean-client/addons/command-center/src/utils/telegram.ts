import fetch from 'cross-fetch'
import { isNullOrEmpty } from './helpers'
import { StoredSettings } from './store'

interface TelegramNotification {
  message: TelegramMessage
}

interface TelegramMessage {
  message_id: number
  from: TelegramUser
  chat: TelegramChat
  text: string
  entities: TelegramEntity[]
}

interface TelegramUser {
  is_bot: boolean
  username: string
}

interface TelegramChat {
  id: number
  type: string
}

interface TelegramEntity {
  type: string
}

export interface Message {
  id: number
  command: string
  username: string
  is_bot: boolean
  chat_id: string
  chat_type: string
  entity: string
}

export class Telegram {
  private readonly prefix: string = '[CommandCenter]'
  readonly chatId: string = ''
  readonly token: string = ''
  private readonly endpoint: string =
    'https://api.telegram.org/bot%token/sendMessage?chat_id=%chatId&text=%message&parse_mode=Markdown'
  private readonly messages: string = 'https://api.telegram.org/bot%token/getUpdates'

  constructor(settings: StoredSettings, prefix: string = '') {
    this.token = settings.token
    this.chatId = settings.chatId
    this.prefix = prefix
  }

  async getMessages(): Promise<Message[]> {
    if (isNullOrEmpty(this.token)) {
      return []
    }

    let messagesUrl = this.messages.replace('%token', this.token)

    const response = await fetch(messagesUrl)
    let json = await response.json()
    let notifications = json['result'] as TelegramNotification[]
    notifications = notifications.filter(
      (notification) =>
        notification.message !== undefined &&
        notification.message.entities !== undefined &&
        notification.message.chat?.id === +this.chatId,
    )
    console.log('got telegram messages: ' + JSON.stringify(notifications))
    return notifications.map((notification) => {
      let entity = ''
      if (notification.message.entities.length > 0) {
        entity = notification.message.entities[0].type
      }
      return {
        id: notification.message.message_id,
        command: notification.message.text.trim(),
        username: notification.message.from.username,
        is_bot: notification.message.from.is_bot,
        chat_id: '' + notification.message.chat.id,
        chat_type: notification.message.chat.type,
        entity: entity,
      }
    })
  }

  async send(message: string): Promise<unknown> {
    if (isNullOrEmpty(this.chatId) || isNullOrEmpty(this.token)) {
      return
    }
    return this.internalSend(message, this.chatId, this.token)
  }

  async internalSend(message: string, chatId: string, token: string): Promise<unknown> {
    let endpointUrl = this.endpoint
      .replace('%token', token)
      .replace('%chatId', chatId)
      .replace('%message', encodeURI(this.prefix + ' ' + message))

    const response = await fetch(endpointUrl)
    const json = await response.json()
    console.log('telegram api response', json)
    return json
  }
}
