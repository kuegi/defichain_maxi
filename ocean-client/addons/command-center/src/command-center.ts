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
import { AvailableBots, Bot } from './utils/available-bot'
import { checkSafetyOf } from './utils/helpers'
import { Store, StoredSettings } from './utils/store'
import { Message, Telegram } from './utils/telegram'
import { VersionCheck } from './utils/version-check'

const VERSION = 'v1.0beta2'

const MIN_MAXI_VERSION = { major: '2', minor: '0' }
const MIN_REINVEST_VERSION = { major: '1', minor: '0' }

async function execute(
  messages: Message[],
  telegram: Telegram,
  store: Store,
  availableBots: AvailableBots,
  versionCheck: VersionCheck,
) {
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
        command = new Bots(telegram, store, availableBots, commandData, versionCheck)
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

export async function main(): Promise<Object> {
  const store = new Store()
  const settings = await store.fetchSettings()

  const telegram = new Telegram(settings, '\\[CommandCenter ' + process.env.AWS_REGION + ' ' + VERSION + ']')

  const versionCheck = new VersionCheck(settings, MIN_MAXI_VERSION, MIN_REINVEST_VERSION)
  const outdatedAction = async () => {
    await telegram.send(
      '\nError: Versions are not compatible.\nPlease check your installed versions. You need\nvault-maxi ' +
        VersionCheck.join(MIN_MAXI_VERSION) +
        '\nlm-reinvest ' +
        VersionCheck.join(MIN_REINVEST_VERSION),
    )
    return { statusCode: 500 }
  }

  try {
    if (!versionCheck.isCompatibleWith(Bot.MAXI) || !versionCheck.isCompatibleWith(Bot.REINVEST)) {
      return outdatedAction()
    }
  } catch {
    return outdatedAction()
  }

  const availableBots = new AvailableBots(settings)

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
    await execute(messages, telegram, store, availableBots, versionCheck)
  }

  return { statusCode: 200 }
}
