import { Bot } from './available-bot'
import { StoredSettings } from './store'

interface Version {
  major: string
  minor: string
}

export class VersionCheck {
  private readonly settings: StoredSettings
  private readonly minVaultMaxi: Version
  private readonly minReinvest: Version

  constructor(settings: StoredSettings, minVaultMaxi: Version, minReinvest: Version) {
    this.settings = settings
    this.minVaultMaxi = minVaultMaxi
    this.minReinvest = minReinvest
  }

  isCompatibleWith(bot: Bot): boolean {
    console.log(`is ${bot} compatible`)
    switch (bot) {
      case Bot.MAXI:
        return this.isEqualOrAbove(VersionCheck.extractVersion(this.settings.state), this.minVaultMaxi)
      case Bot.REINVEST:
        return this.isEqualOrAbove(VersionCheck.extractVersion(this.settings.reinvest?.state), this.minReinvest)
      default:
        return false
    }
  }

  static join(version: Version): string {
    return `v${version.major}.${version.minor}`
  }

  private isEqualOrAbove(version: string, minVersion: Version): boolean {
    // Krysh: check if state has a value, if not vault-maxi is not installed, therefore no compatible check needed
    if (!version || version.length === 0) return true

    console.log('  with version', version)
    console.log('  min version', VersionCheck.join(minVersion))
    const realVersion = VersionCheck.split(version)
    const result =
      this.doCheck(realVersion.major, minVersion.major) && this.doCheck(realVersion.minor, minVersion.minor)
    console.log('  result', result)

    return result
  }

  private doCheck(version: string, minVersion: string): boolean {
    return +version >= +minVersion
  }

  private static split(version: string): Version {
    const components = version.split('.')
    if (components.length === 1) return { major: components[0], minor: '0' }
    else return { major: components[0], minor: components[1] }
  }

  static extractVersion(state?: string): string {
    if (!state) return ''
    const components = state.split('|')
    if (components.length !== 5) throw new Error('no version in state found')
    return components[components.length - 1].replace('v', '')
  }

  static extractJoinedVersion(state?: string): string {
    const versionString = this.extractVersion(state)
    const version = this.split(versionString)
    return this.join(version)
  }
}
