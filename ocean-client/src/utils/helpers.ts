import { LoanVaultActive } from '@defichain/whale-api-client/dist/api/loan'
import { BigNumber } from '@defichain/jellyfish-api-core'

export function isNullOrEmpty(value: string): boolean {
  return value === undefined || value.length === 0
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
