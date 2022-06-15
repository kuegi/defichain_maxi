import { ChangeTokenTo } from './commands/change-token-to'
import { CheckMaxi } from './commands/check-maxi'
import { Command, Commands } from './commands/command'
import { Execute } from './commands/execute'
import { Help } from './commands/help'
import { RemoveExposure } from './commands/remove-exposure'
import { SetRange } from './commands/set-range'
import { SetReinvest } from './commands/set-reinvest'
import { SetToken } from './commands/set-token'
import { Skip } from './commands/skip'
import { checkSafetyOf } from './utils/helpers'
import { Store, StoredSettings } from './utils/store'
import { Message, Telegram } from './utils/telegram'

const VERSION = "v1.0beta"

async function execute(messages: Message[], settings: StoredSettings, telegram: Telegram, store: Store) {
    for (const message of messages) {
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
            case Commands.Execute:
                command = new Execute(telegram)
                break
            case Commands.Skip:
                command = new Skip(telegram, store)
                break
            case Commands.RemoveExposure:
                command = new RemoveExposure(telegram)
                break
            case Commands.SetRange:
                command = new SetRange(telegram, store, commandData)
                break
            case Commands.SetReinvest:
                command = new SetReinvest(telegram, store, commandData)
                break
            case Commands.SetToken:
                command = new SetToken(telegram, store, commandData)
                await (command as SetToken).prepare()
                break
            case Commands.ChangeTokenTo:
                command = new ChangeTokenTo(telegram, store, commandData)
                await (command as ChangeTokenTo).prepare()
                break
            default:
                console.log("ignore " + message.command)
                break
        }
        await telegram.send("executing " + message.command)
        await command?.execute()
    }
}

export async function main(): Promise<Object> {

    const store = new Store()
    let settings = await store.fetchSettings()

    const telegram = new Telegram(settings, "[CommandCenter " + process.env.AWS_REGION + " " + VERSION + "]")
    let messages = await telegram.getMessages()
    messages = messages.filter((message) => {
        return checkSafetyOf(message, settings)
    })
    if (messages.length > 0) {
        // Krysh: update last message right away to avoid infinite error loops because of some command
        // couldn't be processed.
        await store.updateExecutedMessageId(messages.slice(-1)[0].id)
        let isIdle = settings.state.startsWith("idle")
        if (isIdle) {
            await execute(messages, settings, telegram, store)
        } else {
            await telegram.send("Your vault-maxi is busy. Try again later")
        }
    }

    return { statusCode: 200 }
}