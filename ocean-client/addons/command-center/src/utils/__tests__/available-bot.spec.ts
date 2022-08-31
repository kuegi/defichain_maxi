import { AvailableBots, Bot } from '../available-bot'
import { StoredSettings } from '../store'
import { createCustomStoredSettings } from './mock/stored-settings.mock'

enum TestCase {
  EMPTY,
  VAULT_MAXI,
  LM_REINVEST,
  ALL,
}

describe('AvailableBots', () => {
  let availableBots: AvailableBots

  function setup(testCase: TestCase) {
    const customStoredSettings: Partial<StoredSettings> = {}

    switch (testCase) {
      case TestCase.EMPTY:
        break
      case TestCase.VAULT_MAXI:
        customStoredSettings.state = `idle|none||2145914|v2.1`
        break
      case TestCase.LM_REINVEST:
        customStoredSettings.reinvest = { state: `idle|none||2145910|1` }
        break
      case TestCase.ALL:
        customStoredSettings.state = `idle|none||2145914|v2.1`
        customStoredSettings.reinvest = { state: `idle|none||2145910|1` }
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
      [
        Bot.MAXI,
        {
          name: 'maxi',
          version: 'v2.1',
          lastBlock: 2145914,
        },
      ],
    ])
  })

  it('should list lm-reinvest, if lm-reinvest is available', () => {
    setup(TestCase.LM_REINVEST)
    expect(availableBots.list()).toStrictEqual([
      [
        Bot.REINVEST,
        {
          name: 'lm-re',
          version: 'v1.0',
          lastBlock: 2145910,
        },
      ],
    ])
  })

  it('should list all bots, if all are available', () => {
    setup(TestCase.ALL)
    expect(availableBots.list()).toStrictEqual([
      [
        Bot.MAXI,
        {
          name: 'maxi',
          version: 'v2.1',
          lastBlock: 2145914,
        },
      ],
      [
        Bot.REINVEST,
        {
          name: 'lm-re',
          version: 'v1.0',
          lastBlock: 2145910,
        },
      ],
    ])
  })

  it('should return all bots, if all are available', () => {
    setup(TestCase.ALL)
    expect(availableBots.getBots()).toStrictEqual([Bot.MAXI, Bot.REINVEST])
  })

  it('should return true if vault-maxi is available', () => {
    setup(TestCase.VAULT_MAXI)
    expect(availableBots.isAvailable(Bot.MAXI)).toBeTruthy()
  })

  it('should return false if vault-maxi is not available', () => {
    setup(TestCase.LM_REINVEST)
    expect(availableBots.isAvailable(Bot.MAXI)).toBeFalsy()
  })
})
