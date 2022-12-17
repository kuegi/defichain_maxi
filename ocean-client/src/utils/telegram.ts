import fetch from 'cross-fetch'
import { isNullOrEmpty } from './helpers'

export enum LogLevel {
  CRITICAL = 4, //could work before but is now not able to work: panic mode, immediate action required
  ERROR = 3, //error in config or process, user action required
  WARNING = 2, //not good, but can still work: user action recommended
  INFO = 1, //info that something happened, no action required
  VERBOSE = 0, // ...
}

export function prefixFromLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.CRITICAL:
      return '🚨🆘🚨'
    case LogLevel.ERROR:
      return '🚨'
    case LogLevel.WARNING:
      return '⚠️'
    case LogLevel.INFO:
      return 'ℹ️'
    case LogLevel.VERBOSE:
      return '🗣️'
    default:
      return '❔'
  }
}

export function nameFromLogLevel(level: LogLevel): string {
  for (const [key, l] of Object.entries(LogLevel)) {
    if (l == level) {
      return key
    }
  }
  return 'unkown'
}

export function logLevelFromParam(param: string | undefined): LogLevel {
  if (!param) {
    return LogLevel.INFO
  }
  //CRITICAL not here on purpose. min level for notifications is Error
  const usedParam = param.toLowerCase()
  //tried to make this work with some iteration, but failed
  if (usedParam.startsWith('err')) {
    return LogLevel.ERROR
  }

  if (usedParam.startsWith('warn')) {
    return LogLevel.WARNING
  }

  if (usedParam.startsWith('info')) {
    return LogLevel.INFO
  }

  if (usedParam.startsWith('verbose')) {
    return LogLevel.VERBOSE
  }

  return LogLevel.INFO
}

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
      await this.internalSend(level, message, this.logChatId, this.logToken)
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
    return await this.internalSend(level, message, chatId, token)
  }

  async internalSend(
    level: LogLevel,
    message: string,
    chatId: string,
    token: string,
    retryCount: number = 0,
  ): Promise<void> {
    if (retryCount >= 3) {
      return
    }
    let endpointUrl = this.endpoint
      .replace('%token', token)
      .replace('%chatId', chatId)
      .replace('%message', encodeURI(this.prefix + prefixFromLogLevel(level) + ' ' + message))

    await fetch(endpointUrl)
      .then((response) => {
        return response.json()
      })
      .catch((e) => {
        console.error('error in telegram send: ' + e)
        this.internalSend(level, message, chatId, token, retryCount + 1)
      })
    return
  }
}
