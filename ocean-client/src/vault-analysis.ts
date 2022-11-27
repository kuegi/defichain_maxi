import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'

class Ocean {
  public readonly c: WhaleApiClient

  constructor() {
    this.c = new WhaleApiClient({
      url: 'https://ocean.defichain.com',
      version: 'v0',
    })
  }

  public async getAll<T>(call: () => Promise<ApiPagedResponse<T>>, maxAmount: number = -1): Promise<T[]> {
    const pages = [await call()]
    let total = 0
    while (pages[pages.length - 1].hasNext && (maxAmount < 0 || total < maxAmount)) {
      try {
        pages.push(await this.c.paginate(pages[pages.length - 1]))
        total += pages[pages.length - 1].length
      } catch (e) {
        break
      }
    }

    return pages.flatMap((page) => page as T[])
  }
}

class BotData {
  public minRatio = 300
  public maxRatio = 0
  public avgRatio = 0
  public avgRatioWeighted = 0
  public aum = 0
  public totalLoans = 0
  public totalDUSD = 0
  public minCollateral = 99999999999999999
  public maxCollateral = 0
  public miovaults: LoanVaultActive[] = []
  public allvaults: LoanVaultActive[] = []

  public toString(): string {
    let result = `${this.allvaults.length} vaults`
    if (this.allvaults.length > 0) {
      result +=
        `\nratio: ${this.minRatio} - ${this.maxRatio} avg ${this.avgRatio.toFixed(
          2,
        )} w: ${this.avgRatioWeighted.toFixed(2)}\n` +
        `coll: \$${this.minCollateral.toFixed(0)}-\$${this.maxCollateral.toFixed(0)} total: ${this.aum.toFixed(0)} (${
          this.miovaults.length
        } mio vaults)\n` +
        `loans: \$${this.totalLoans.toFixed(0)} dusd: ${this.totalDUSD.toFixed(0)}`
    }
    return result
  }
}

function analysevaults(vaults: LoanVaultActive[]): BotData {
  console.log('analysing data of ' + vaults.length + ' vaults')
  const data = new BotData()
  data.allvaults = vaults
  vaults.forEach((v) => {
    data.minRatio = Math.min(data.minRatio, +v.collateralRatio)
    data.maxRatio = Math.max(data.maxRatio, +v.collateralRatio)
    data.avgRatio += +v.collateralRatio
    data.avgRatioWeighted += +v.collateralRatio * +v.collateralValue
    data.aum += +v.collateralValue
    data.minCollateral = Math.min(data.minCollateral, +v.collateralValue)
    data.maxCollateral = Math.max(data.maxCollateral, +v.collateralValue)
    data.totalLoans += +v.loanValue
    v.loanAmounts.forEach((loan) => {
      if (loan.symbol === 'DUSD') {
        data.totalDUSD += +loan.amount
      }
    })
    if (+v.collateralValue > 1e6) {
      data.miovaults.push(v)
    }
  })
  data.avgRatio /= vaults.length
  data.avgRatioWeighted /= data.aum
  return data
}

function compArray(array1: string[], array2: string[]) {
  array1.sort((a, b) => (a < b ? 1 : -1))
  array2.sort((a, b) => (a < b ? 1 : -1))
  if (array1.length != array2.length) {
    return false
  }
  for (let index = 0; index < array1.length; index++) {
    if (array1[index] !== array2[index]) {
      return false
    }
  }
  return true
}

export async function main(event: any, context: any): Promise<Object> {
  const o = new Ocean()
  //read all vaults
  console.log('reading vaults')
  const vaultlist = await o.getAll(() => o.c.loan.listVault(1000))
  console.log('got ' + vaultlist.length + ' vaults, now filtering')
  //filter for actives with min collateral and loan and bech32 owner
  const MIN_COLLATERAL = 50
  const nonEmptyVaults = vaultlist.filter(
    (v) => v.state == LoanVaultState.ACTIVE && +v.collateralValue > MIN_COLLATERAL,
  ) as LoanVaultActive[]
  const usedVaults = nonEmptyVaults.filter((v) => v.loanAmounts.length > 0)
  // only consider bech32 owner with reasonable collRatio and either DUSD in loan or collateral (double mint and DFI single mint has loan, DUSD singlemint has collateral)
  const possibleBotVaults = usedVaults.filter(
    (v) =>
      v.ownerAddress.startsWith('df1') &&
      +v.collateralRatio < +v.loanScheme.minColRatio * 2 &&
      (v.loanAmounts.find((l) => l.symbol === 'DUSD') !== undefined ||
        v.collateralAmounts.find((c) => c.symbol === 'DUSD') !== undefined),
  ) as LoanVaultActive[]

  let allBotVaults: LoanVaultActive[] = []
  let singleMintDUSD: LoanVaultActive[] = []
  let singleMintDFI: LoanVaultActive[] = []
  let wizardVaults: LoanVaultActive[] = []
  let doubleMinVaultsUnclear: LoanVaultActive[] = []

  console.log('analysing ' + possibleBotVaults.length + ' vaults with history')
  let done = 0
  for (const vault of possibleBotVaults) {
    //get history of owner
    if (++done % 100 == 0) {
      console.log('done ' + done + ' vaults, got ' + allBotVaults.length + ' bot vaults so far')
    }

    const wantedTypes = ['AddPoolLiquidity', 'WithdrawFromVault', 'TakeLoan', 'PaybackLoan', 'RemovePoolLiquidity']
    const history = await o.c.address.listAccountHistory(vault.ownerAddress, 400)
    const dusdHistory = history.filter(
      (h) =>
        h.amounts.find((a) => a.includes('DUSD')) !== undefined && wantedTypes.find((a) => h.type === a) !== undefined,
    )
    dusdHistory.sort((a, b) => b.block.height - a.block.height)
    let prevblock = 0
    let prevType = ''
    let prevAmounts: string[] = []
    let doubleMintUnclear = false
    for (const h of dusdHistory) {
      if (
        h.block.height === prevblock &&
        (compArray([prevType, h.type], ['AddPoolLiquidity', 'TakeLoan']) ||
          compArray([prevType, h.type], ['AddPoolLiquidity', 'WithdrawFromVault']))
      ) {
        allBotVaults.push(vault)
        //if takeloan takes only DUSD and AddPool is for DUSD-DFI -> its maxi single mint DFI
        if (prevAmounts.concat(h.amounts).find((a) => a.includes('DUSD-DFI')) !== undefined) {
          //addLiquidity into DUSD-DFI -> single mint DFI
          singleMintDFI.push(vault)
        } else if (compArray([prevType, h.type], ['AddPoolLiquidity', 'WithdrawFromVault'])) {
          singleMintDUSD.push(vault)
        } else {
          doubleMintUnclear = true
        }
        break
      }
      prevblock = h.block.height
      prevType = h.type
      prevAmounts = h.amounts
    }
    if (doubleMintUnclear) {
      prevblock = 0
      prevType = ''
      for (const h of dusdHistory) {
        //wizard goes removeLiquidity and payback in same block (ignoring dust)
        if (h.block.height === prevblock && compArray([prevType, h.type], ['PaybackLoan', 'RemovePoolLiquidity'])) {
          wizardVaults.push(vault)
          doubleMintUnclear = false
          break
        }
        prevblock = h.block.height
        prevType = h.type
      }
    }
    if (doubleMintUnclear) {
      //TODO: check for full history and wizard config tx?
      doubleMinVaultsUnclear.push(vault)
    }
  }

  //analyse Botdata

  const allData = analysevaults(allBotVaults)
  const dusdData = analysevaults(singleMintDUSD)
  const dfiData = analysevaults(singleMintDFI)
  const wizardData = analysevaults(wizardVaults)
  const unclearDoubleMint = analysevaults(doubleMinVaultsUnclear)
  console.log('allData:\n' + allData.toString())
  console.log('all data vaults: ' + JSON.stringify(allData.allvaults.map((v) => v.vaultId)))
  console.log('dusd singlemint:\n' + dusdData.toString())
  console.log('vaults: ' + JSON.stringify(dusdData.allvaults.map((v) => v.vaultId)))
  console.log('dfi singlemint:\n' + dfiData.toString())
  console.log(' vaults: ' + JSON.stringify(dfiData.allvaults.map((v) => v.vaultId)))
  console.log('wizard:\n' + wizardData.toString())
  console.log('vaults: ' + JSON.stringify(wizardData.allvaults.map((v) => v.vaultId)))
  console.log('unclearDoubleMint:\n' + unclearDoubleMint.toString())
  console.log('vaults: ' + JSON.stringify(unclearDoubleMint.allvaults.map((v) => v.vaultId)))
  return { statusCode: 200 }
}
