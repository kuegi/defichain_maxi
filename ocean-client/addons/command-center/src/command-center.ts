import { Bots } from './commands/bots'
import { Check } from './commands/check'
import { Command, Commands } from './commands/command'
import { Execute } from './commands/execute'
import { Help } from './commands/help'
import { RemoveExposure } from './commands/remove-exposure'
import { Resume } from './commands/resume'
import { SetAutoDonation } from './commands/set-auto-donation'
import { SetPair } from './commands/set-pair'
import { SetRange } from './commands/set-range'
import { SetReinvest } from './commands/set-reinvest'
import { SetStableArbSize } from './commands/set-stable-arb-size'
import { Skip } from './commands/skip'
import { AvailableBots, BotType } from './utils/available-bot'
import { checkSafetyOf } from './utils/helpers'
import { SetupCheck } from './utils/setup-check'
import { Store, StoredSettings } from './utils/store'
import { Message, Telegram } from './utils/telegram'
import { VersionCheck } from './utils/version-check'

const VERSION = 'v1.0-rc'

export const MIN_MAXI_VERSION = { major: '2', minor: '0' }
export const MIN_REINVEST_VERSION = { major: '1', minor: '0' }

interface CommandCenterEvent {
  checkSetup?: boolean
}

async function execute(messages: Message[], telegram: Telegram, store: Store, availableBots: AvailableBots) {
  for (const message of messages) {
    let commandData = message.command.split(' ')
    if (commandData.length == 0) {
      continue
    }
    let command: Command | undefined
    switch (commandData[0]) {
      case Commands.Help:
        command = new Help(telegram, store, availableBots, commandData)
        break
      case Commands.Bots:
        command = new Bots(telegram, store, availableBots, commandData)
        break
      case Commands.Check:
        command = new Check(telegram, store, availableBots, commandData)
        break
      case Commands.Execute:
        command = new Execute(telegram, store, availableBots, commandData)
        break
      case Commands.Skip:
        command = new Skip(telegram, store, availableBots, commandData)
        break
      case Commands.Resume:
        command = new Resume(telegram, store, availableBots, commandData)
        break
      case Commands.RemoveExposure:
        command = new RemoveExposure(telegram, store, availableBots, commandData)
        break
      case Commands.SetRange:
        command = new SetRange(telegram, store, availableBots, commandData)
        break
      case Commands.SetReinvest:
        command = new SetReinvest(telegram, store, availableBots, commandData)
        break
      case Commands.SetStableArbSize:
        command = new SetStableArbSize(telegram, store, availableBots, commandData)
        break
      case Commands.SetAutoDonation:
        command = new SetAutoDonation(telegram, store, availableBots, commandData)
        break
      case Commands.SetPair:
        command = new SetPair(telegram, store, availableBots, commandData)
        await (command as SetPair).prepare()
        break
      default:
        console.log('ignore ' + message.command)
        break
    }
    await telegram.send('executing ' + message.command)
    await command?.execute()
  }
}

function isFirstRun(settings: StoredSettings): boolean {
  return settings.lastExecutedMessageId === 0
}

export async function main(event: CommandCenterEvent): Promise<Object> {
  console.log(`running ${VERSION}`)
  const store = new Store()
  await store.searchForBots()
  const settings = await store.fetchSettings()

  const logId = process.env.VAULTMAXI_LOGID ? ' ' + process.env.VAULTMAXI_LOGID : ''
  const telegram = new Telegram(settings, '\\[CommandCenter ' + process.env.AWS_REGION + ' ' + VERSION + logId + ']')

  if (event && event.checkSetup) {
    await SetupCheck.with(settings, telegram)
    return { statusCode: 200 }
  }

  const availableBots = new AvailableBots(settings)

  VersionCheck.initialize(settings, MIN_MAXI_VERSION, MIN_REINVEST_VERSION)

  let messages = await telegram.getMessages()
  messages = messages.filter((message) => {
    return checkSafetyOf(message, settings)
  })
  if (messages.length > 0) {
    // Krysh: update last message right away to avoid infinite error loops because of some command
    // couldn't be processed.
    await store.updateExecutedMessageId(messages[messages.length - 1].id)
    console.log('messages to be executed', messages.length)
    // Krysh: if we are on the first run, ignore every command besides the last one
    // to prevent any "old" commands to be executed
    if (isFirstRun(settings)) {
      messages = messages.slice(-1)
      console.log('is first run, reduce to', messages.length)
    }
    await execute(messages, telegram, store, availableBots)
  }

  return { statusCode: 200 }
}
