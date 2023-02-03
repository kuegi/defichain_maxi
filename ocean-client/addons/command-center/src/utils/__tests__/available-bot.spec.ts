import { AvailableBots, BotType, PossibleBot } from '../available-bot'
import { StoredSettings } from '../store'
import { createCustomStoredSettings } from './mock/stored-settings.mock'

enum TestCase {
  EMPTY,
  VAULT_MAXI,
  VAULT_MAXI_EXTENSION,
  LM_REINVEST,
  ALL,
}

const testMaxi: PossibleBot = {
  bot: BotType.MAXI,
  name: 'defichain-vault-maxi',
  stateParameter: '/defichain-maxi/state',
  stateValue: `idle|none||2145914|v2.1`,
}

const testMaxiWithExtension: PossibleBot = {
  bot: BotType.MAXI,
  name: 'defichain-vault-maxi-test',
  stateParameter: '/defichain-maxi-test/state',
  stateValue: `idle|none||2145914|v2.1`,
}

const testReinvest: PossibleBot = {
  bot: BotType.REINVEST,
  name: 'defichain-lm-reinvest',
  stateParameter: '/defichain-maxi/reinvest',
  stateValue: `idle|none||2145910|1`,
}

describe('AvailableBots', () => {
  let availableBots: AvailableBots

  function setup(testCase: TestCase) {
    const customStoredSettings: Partial<StoredSettings> = {}

    switch (testCase) {
      case TestCase.EMPTY:
        break
      case TestCase.VAULT_MAXI:
        customStoredSettings.states = [testMaxi]
        break
      case TestCase.VAULT_MAXI_EXTENSION:
        customStoredSettings.states = [testMaxiWithExtension]
        break
      case TestCase.LM_REINVEST:
        customStoredSettings.states = [testReinvest]
        break
      case TestCase.ALL:
        customStoredSettings.states = [testMaxi, testMaxiWithExtension, testReinvest]
        break
    }

    availableBots = new AvailableBots(createCustomStoredSettings(customStoredSettings))
  }

  it('should list no bots, if empty', () => {
    setup(TestCase.EMPTY)
    expect(availableBots.list()).toStrictEqual([])
  })

  it('should list vault-maxi, if vault-maxi is available', () => {
    setup(TestCase.VAULT_MAXI)
    expect(availableBots.list()).toStrictEqual([
      {
        name: 'defichain-vault-maxi',
        postfix: '',
        type: BotType.MAXI,
        version: 'v2.1',
        lastBlock: 2145914,
        isIdle: true,
      },
    ])
  })

  it('should list lm-reinvest, if lm-reinvest is available', () => {
    setup(TestCase.LM_REINVEST)
    expect(availableBots.list()).toStrictEqual([
      {
        name: 'defichain-lm-reinvest',
        postfix: '',
        type: BotType.REINVEST,
        version: 'v1.0',
        lastBlock: 2145910,
        isIdle: true,
      },
    ])
  })

  it('should list all bots, if all are available', () => {
    setup(TestCase.ALL)
    expect(availableBots.list()).toStrictEqual([
      {
        name: 'defichain-vault-maxi',
        postfix: '',
        type: BotType.MAXI,
        version: 'v2.1',
        lastBlock: 2145914,
        isIdle: true,
      },
      {
        name: 'defichain-vault-maxi-test',
        postfix: '-test',
        type: BotType.MAXI,
        version: 'v2.1',
        lastBlock: 2145914,
        isIdle: true,
      },
      {
        name: 'defichain-lm-reinvest',
        postfix: '',
        type: BotType.REINVEST,
        version: 'v1.0',
        lastBlock: 2145910,
        isIdle: true,
      },
    ])
  })

  it('should return true if vault-maxi is available', () => {
    setup(TestCase.VAULT_MAXI)
    expect(availableBots.isAvailable('maxi')).toBeTruthy()
  })

  it('should return true if maxi-test is available', () => {
    setup(TestCase.VAULT_MAXI_EXTENSION)
    expect(availableBots.isAvailable('maxi-test')).toBeTruthy()
  })

  it('should return false if vault-maxi is not available', () => {
    setup(TestCase.LM_REINVEST)
    expect(availableBots.isAvailable('maxi')).toBeFalsy()
  })
})
