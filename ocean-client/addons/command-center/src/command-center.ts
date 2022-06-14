import { CheckMaxi } from './commands/check-maxi'
import { Command, Commands } from './commands/command'
import { Help } from './commands/help'
import { RemoveExposure } from './commands/remove-exposure'
import { SetRange } from './commands/set-range'
import { Skip } from './commands/skip'
import { checkSafetyOf } from './utils/helpers'
import { Store, StoredSettings } from './utils/store'
import { Message, Telegram } from './utils/telegram'

const VERSION = "v1.0beta"

async function execute(messages: Message[], settings: StoredSettings, telegram: Telegram, store: Store) {
    for (const message of messages) {
        let isSafe = checkSafetyOf(message, settings)
        if (isSafe) {
            let commandData = message.command.split(" ")
            if (commandData.length == 0) {
                continue
            }
            let command: Command | undefined
            switch (commandData[0]) {
                case Commands.Help:
                    command = new Help(telegram, store)
                    break
                case Commands.CheckMaxi:
                    command = new CheckMaxi(telegram)
                    break
                case Commands.Skip:
                    command = new Skip(telegram, store)
                    break
                case Commands.RemoveExposure:
                    command = new RemoveExposure(telegram, store)
                    break
                case Commands.SetRange:
                    command = new SetRange(telegram, store, commandData)
                    break
                default:
                    console.log("ignore " + message.command)
                    break
            }
            await command?.execute()
        }
    }
}

export async function main(): Promise<Object> {

    const store = new Store()
    let settings = await store.fetchSettings()

    const telegram = new Telegram(settings, "[CommandCenter " + process.env.AWS_REGION + " " + VERSION + "]")
    let messages = await telegram.getMessages()
    await execute(messages, settings, telegram, store)
    await store.updateExecutedMessageId(messages.slice(-1)[0].id)

    return { statusCode: 200 }
}