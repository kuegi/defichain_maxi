import { Telegram } from './telegram'

export class Logger {
  private telegram: Telegram | undefined

  static default = new Logger()

  private constructor() {}

  public setTelegram(telegram: Telegram) {
    this.telegram = telegram
  }

  public log(message: string) {
    this.telegram?.log(message)
  }

  public async waitForLog(message: string): Promise<unknown> {
    return await this.telegram?.log(message)
  }
}
