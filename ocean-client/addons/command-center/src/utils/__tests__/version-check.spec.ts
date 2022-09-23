import { Bot } from '../available-bot'
import { StoredSettings } from '../store'
import { VersionCheck } from '../version-check'
import { createCustomStoredSettings } from './mock/stored-settings.mock'

describe('VersionCheck', () => {
  let versionCheck: VersionCheck

  function setup(vaultMaxiVersion?: string, reinvestVersion?: string, wrongState?: boolean) {
    const minVaultMaxiVersion = { major: '2', minor: '0' }
    const minReinvestVersion = { major: '1', minor: '0' }

    const customStoredSettings: Partial<StoredSettings> = {}
    if (vaultMaxiVersion) customStoredSettings.state = `idle|none||2145914|${vaultMaxiVersion}`
    if (reinvestVersion) customStoredSettings.reinvest = { state: `idle|none||2145835|${reinvestVersion}` }
    if (wrongState) customStoredSettings.state = 'idle|none||2145914'

    versionCheck = new VersionCheck(
      createCustomStoredSettings(customStoredSettings),
      minVaultMaxiVersion,
      minReinvestVersion,
    )
  }

  it('should return compatible for vault-maxi and lm-reinvest versions undefined', () => {
    setup()

    expect(versionCheck.isCompatibleWith(Bot.MAXI)).toBeTruthy()
    expect(versionCheck.isCompatibleWith(Bot.REINVEST)).toBeTruthy()
  })

  it('should return not compatible for vault-maxi, if version is v1.9', () => {
    setup('v1.9')

    expect(versionCheck.isCompatibleWith(Bot.MAXI)).toBeFalsy()
  })

  it('should return compatible for vault-maxi, if version is v2.0', () => {
    setup('v2.0')

    expect(versionCheck.isCompatibleWith(Bot.MAXI)).toBeTruthy()
  })

  it('should return compatible for vault-maxi, if version is v2.1', () => {
    setup('v2.1')

    expect(versionCheck.isCompatibleWith(Bot.MAXI)).toBeTruthy()
  })

  it('should return not compatible for lm-reinvest, if version is v0.9', () => {
    setup(undefined, 'v0.9')

    expect(versionCheck.isCompatibleWith(Bot.REINVEST)).toBeFalsy()
  })

  it('should return compatible for lm-reinvest, if version is v1.0', () => {
    setup(undefined, 'v1.0')

    expect(versionCheck.isCompatibleWith(Bot.REINVEST)).toBeTruthy()
  })

  it('should return compatible for lm-reinvest, if version is v1.1', () => {
    setup(undefined, 'v1.1')

    expect(versionCheck.isCompatibleWith(Bot.REINVEST)).toBeTruthy()
  })

  it('should return compatible for lm-reinvest, if version is 1', () => {
    setup(undefined, '1')

    expect(versionCheck.isCompatibleWith(Bot.REINVEST)).toBeTruthy()
  })

  it('should throw error if state has no version', () => {
    setup(undefined, undefined, true)

    expect(() => {
      versionCheck.isCompatibleWith(Bot.MAXI)
    }).toThrowError('no version in state found')
  })

  it('should return v2.0 for version major 2 and minor 0', () => {
    expect(VersionCheck.join({ major: '2', minor: '0' })).toStrictEqual('v2.0')
  })

  it('should return v1.0 for state idle|none||2145914|1', () => {
    expect(VersionCheck.extractJoinedVersion('idle|none||2145914|1')).toStrictEqual('v1.0')
  })
})
