import { MainNet } from '@defichain/jellyfish-network'
import { AccountToAccount, OP_DEFI_TX, toOPCodes } from '@defichain/jellyfish-transaction/dist'
import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { SmartBuffer } from 'smart-buffer'
import { fromScript } from '@defichain/jellyfish-address'
import { sendToS3 } from './utils/helpers'

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

  public toJSON(): Object {
    return {
      minRatio: this.minRatio,
      maxRatio: this.maxRatio,
      avgRatio: this.avgRatio,
      avgRatioWeighted: this.avgRatioWeighted,
      totalCollateral: this.aum,
      totalLoans: this.totalLoans,
      totalDUSDLoans: this.totalDUSD,
      minCollateral: this.minCollateral,
      maxCollateral: this.maxCollateral,
      totalVaults: this.allvaults.length,
    }
  }
}

function analysevaults(vaults: LoanVaultActive[]): BotData {
  console.log('analysing data of ' + vaults.length + ' vaults')
  const data = new BotData()
  data.allvaults = vaults
  let vaultsWithRatio = 0
  let aumInRatioVaults = 0
  vaults.forEach((v) => {
    if (+v.collateralRatio > 0) {
      data.minRatio = Math.min(data.minRatio, +v.collateralRatio)
      data.maxRatio = Math.max(data.maxRatio, +v.collateralRatio)
      data.avgRatio += +v.collateralRatio
      data.avgRatioWeighted += +v.collateralRatio * +v.collateralValue
      vaultsWithRatio++
      aumInRatioVaults += +v.collateralValue
    }
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
  data.avgRatio /= vaultsWithRatio
  data.avgRatioWeighted /= aumInRatioVaults
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

class Parameters {
  minCollateral = 50
  minLoansForUsed = 10
  maxHistory = 400
}

export async function main(event: any, context: any): Promise<Object> {
  const o = new Ocean()

  const params = new Parameters()

  //read all vaults
  console.log('reading vaults')
  const vaultlist = await o.getAll(() => o.c.loan.listVault(500))
  console.log('got ' + vaultlist.length + ' vaults, now filtering')
  //filter for actives with min collateral and loan and bech32 owner
  const nonEmptyVaults = vaultlist.filter(
    (v) => v.state == LoanVaultState.ACTIVE && +v.collateralValue > params.minCollateral,
  ) as LoanVaultActive[]
  const usedVaults = nonEmptyVaults.filter((v) => +v.loanValue > params.minLoansForUsed)
  // only consider bech32 owner with reasonable collRatio and either DUSD in loan or collateral (double mint and DFI single mint has loan, DUSD singlemint has collateral)
  const possibleBotVaults = usedVaults.filter(
    (v) =>
      v.ownerAddress.startsWith('df1') &&
      +v.collateralRatio < +v.loanScheme.minColRatio * 2 &&
      (v.loanAmounts.find((l) => l.symbol === 'DUSD') !== undefined ||
        v.collateralAmounts.find((c) => c.symbol === 'DUSD') !== undefined) &&
      v.loanAmounts.length > 0,
  ) as LoanVaultActive[]

  let allBotVaults: LoanVaultActive[] = []
  let singleMintDUSD: LoanVaultActive[] = []
  let singleMintDFI: LoanVaultActive[] = []
  let wizardVaults: LoanVaultActive[] = []
  let doubleMinVaultsUnclear: LoanVaultActive[] = []
  let donatingMaxis: LoanVaultActive[] = []

  console.log('analysing ' + possibleBotVaults.length + ' vaults with history')
  let done = 0
  for (const vault of possibleBotVaults) {
    //get history of owner
    if (++done % 100 == 0) {
      console.log('done ' + done + ' vaults, got ' + allBotVaults.length + ' bot vaults so far')
    }

    const wantedTypes = ['AddPoolLiquidity', 'WithdrawFromVault', 'TakeLoan', 'PaybackLoan', 'RemovePoolLiquidity']
    const history = await o.getAll(
      () => o.c.address.listAccountHistory(vault.ownerAddress, params.maxHistory),
      params.maxHistory,
    )
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
        //check for maxi donation
        const donations = history.filter(
          (h) =>
            h.type === 'AccountToAccount' &&
            h.amounts.length === 1 &&
            h.amounts[0].includes('DFI') &&
            h.amounts[0].startsWith('-'),
        )
        for (const don of donations) {
          const vouts = await o.c.transactions.getVouts(don.txid)

          const dftxData = toOPCodes(SmartBuffer.fromBuffer(Buffer.from(vouts[0].script.hex, 'hex')))
          if (dftxData[1].type == 'OP_DEFI_TX') {
            const dftx = (dftxData[1] as OP_DEFI_TX).tx
            const a2a = dftx.data as AccountToAccount
            let isDonator = false
            if (
              a2a.to.find(
                (target) =>
                  fromScript(target.script, MainNet.name)?.address === 'df1qqtlz4uw9w5s4pupwgucv4shl6atqw7xlz2wn07',
              ) !== undefined
            ) {
              donatingMaxis.push(vault)
              break
            }
          }
        }
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
    /* //full check for sent wizard config takes too long, not doing it
    if (doubleMintUnclear) {
      console.log('checking full history for wizard config')
      const txs = await o.getAll(() => o.c.address.listTransaction(vault.ownerAddress, 200))
      txs.reverse() //config is usually at the beginning
      const opWzTx = '6a004d5c01577a54785' //OP_RETURN 0 'WzTx'...
      for (const tx of txs) {
        const n = tx.vout?.n ?? 0
        if (n == 1) {
          //could be a tx we wanna see
          const vouts = await o.c.transactions.getVouts(tx.txid, 10)
          for (const vout of vouts) {
            if (vout.n == 0) {
              if (vout.script.hex.startsWith(opWzTx)) {
                wizardVaults.push(vault)
                doubleMintUnclear = false
                console.log('found wizard from tx history')
                break
              }
            }
          }
          if (!doubleMintUnclear) {
            break
          }
        }
      }
    }
    //*/
    if (doubleMintUnclear) {
      doubleMinVaultsUnclear.push(vault)
    }
  }

  //analyse Botdata

  const usedVaultsData = analysevaults(usedVaults)
  const allBotData = analysevaults(allBotVaults)
  const dusdData = analysevaults(singleMintDUSD)
  const dfiData = analysevaults(singleMintDFI)
  const wizardData = analysevaults(wizardVaults)
  const doubleMintMaxi = analysevaults(doubleMinVaultsUnclear)
  console.log('donating maxis: ' + donatingMaxis.length)
  console.log('vaults: ' + JSON.stringify(donatingMaxis.map((v) => v.vaultId)))
  console.log('allBotData:\n' + allBotData.toString())
  console.log('all bot vaults: ' + JSON.stringify(allBotData.allvaults.map((v) => v.vaultId)))
  console.log('dusd singlemint:\n' + dusdData.toString())
  console.log('vaults: ' + JSON.stringify(dusdData.allvaults.map((v) => v.vaultId)))
  console.log('dfi singlemint:\n' + dfiData.toString())
  console.log(' vaults: ' + JSON.stringify(dfiData.allvaults.map((v) => v.vaultId)))
  console.log('wizard:\n' + wizardData.toString())
  console.log('vaults: ' + JSON.stringify(wizardData.allvaults.map((v) => v.vaultId)))
  console.log('doubleMintMaxi:\n' + doubleMintMaxi.toString())
  console.log('vaults: ' + JSON.stringify(doubleMintMaxi.allvaults.map((v) => v.vaultId)))

  console.log('sending to S3')
  /*
  const vaultlist = await o.getAll(() => o.c.loan.listVault(200))
  const nonEmptyVaults = vaultlist.filter(
    (v) => v.state == LoanVaultState.ACTIVE && +v.collateralValue > MIN_COLLATERAL,
  ) as LoanVaultActive[]
  const usedVaults = nonEmptyVaults.filter((v) => v.loanAmounts.length > 0)
  // only consider bech32 owner with reasonable collRatio and either DUSD in loan or collateral (double mint and DFI single mint has loan, DUSD singlemint has collateral)
  const possibleBotVaults = usedVaults.filter(
  */
  const date = new Date()
  const forS3 = {
    tstamp: date.toISOString(),
    params: params,
    totalVaults: vaultlist.length,
    nonEmptyVaults: nonEmptyVaults.length,
    usedVaults: usedVaults.length,
    allBotVaults: allBotVaults.length,
    donatingMaxis: donatingMaxis.length,
    vaultData: {
      nonEmptyVaults: analysevaults(nonEmptyVaults).toJSON(),
      usedVaults: usedVaultsData.toJSON(),
    },
    botData: {
      allBotVaults: allBotData.toJSON(),
      dusdSingleMintMaxi: dusdData.toJSON(),
      dfiSingleMintMaxi: dfiData.toJSON(),
      doubleMintMaxi: doubleMintMaxi.toJSON(),
      wizard: wizardData.toJSON(),
    },
  }

  const day = date.toISOString().substring(0, 10)
  await sendToS3(forS3, day + '.json')
  await sendToS3(forS3, 'latest.json')

  return { statusCode: 200 }
}

