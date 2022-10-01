import { BotType, LM_REINVEST, PossibleBot, VAULT_MAXI } from '../available-bot'
import { StoredSettings } from '../store'
import { VersionCheck } from '../version-check'
import { createCustomStoredSettings } from './mock/stored-settings.mock'

const buildVaultMaxi = (vaultMaxiVersion?: string): PossibleBot => {
  return {
    bot: BotType.MAXI,
    name: VAULT_MAXI,
    stateParameter: '/defichain-maxi/state',
    stateValue: `idle|none||2145914|${vaultMaxiVersion}`,
  }
}

const buildReinvest = (reinvestVersion?: string): PossibleBot => {
  return {
    bot: BotType.REINVEST,
    name: LM_REINVEST,
    stateParameter: '/defichain-maxi/state-reinvest',
    stateValue: `idle|none||2145835|${reinvestVersion}`,
  }
}

describe('VersionCheck', () => {
  let versionCheck: VersionCheck

  function setup(vaultMaxiVersion?: string, reinvestVersion?: string, wrongState?: boolean) {
    const minVaultMaxiVersion = { major: '2', minor: '0' }
    const minReinvestVersion = { major: '1', minor: '0' }

    const customStoredSettings: Partial<StoredSettings> = {}
    if (vaultMaxiVersion) customStoredSettings.states = [buildVaultMaxi(vaultMaxiVersion)]
    if (reinvestVersion) customStoredSettings.states = [buildReinvest(reinvestVersion)]
    if (wrongState)
      customStoredSettings.states = [
        {
          bot: BotType.MAXI,
          name: VAULT_MAXI,
          stateParameter: '/defichain-maxi/state',
          stateValue: 'idle|none||2145914',
        },
      ]

    VersionCheck.initialize(createCustomStoredSettings(customStoredSettings), minVaultMaxiVersion, minReinvestVersion)
  }

  it('should return not compatible for vault-maxi and lm-reinvest versions undefined', () => {
    setup()

    expect(VersionCheck.isCompatibleWith(VAULT_MAXI)).toBeFalsy()
    expect(VersionCheck.isCompatibleWith(LM_REINVEST)).toBeFalsy()
  })

  it('should return not compatible for vault-maxi, if version is v1.9', () => {
    setup('v1.9')

    expect(VersionCheck.isCompatibleWith(VAULT_MAXI)).toBeFalsy()
  })

  it('should return compatible for vault-maxi, if version is v2.0', () => {
    setup('v2.0')

    expect(VersionCheck.isCompatibleWith(VAULT_MAXI)).toBeTruthy()
  })

  it('should return compatible for vault-maxi, if version is v2.1', () => {
    setup('v2.1')

    expect(VersionCheck.isCompatibleWith(VAULT_MAXI)).toBeTruthy()
  })

  it('should return not compatible for lm-reinvest, if version is v0.9', () => {
    setup(undefined, 'v0.9')

    expect(VersionCheck.isCompatibleWith(LM_REINVEST)).toBeFalsy()
  })

  it('should return compatible for lm-reinvest, if version is v1.0', () => {
    setup(undefined, 'v1.0')

    expect(VersionCheck.isCompatibleWith(LM_REINVEST)).toBeTruthy()
  })

  it('should return compatible for lm-reinvest, if version is v1.1', () => {
    setup(undefined, 'v1.1')

    expect(VersionCheck.isCompatibleWith(LM_REINVEST)).toBeTruthy()
  })

  it('should return compatible for lm-reinvest, if version is 1', () => {
    setup(undefined, '1')

    expect(VersionCheck.isCompatibleWith(LM_REINVEST)).toBeTruthy()
  })

  it('should throw error if state has no version', () => {
    setup(undefined, undefined, true)

    expect(() => {
      VersionCheck.isCompatibleWith(VAULT_MAXI)
    }).toThrowError('no version in state found')
  })

  it('should return v2.0 for version major 2 and minor 0', () => {
    expect(VersionCheck.join({ major: '2', minor: '0' })).toStrictEqual('v2.0')
  })

  it('should return v1.0 for state idle|none||2145914|1', () => {
    expect(VersionCheck.extractJoinedVersion('idle|none||2145914|1')).toStrictEqual('v1.0')
  })
})
