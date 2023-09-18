import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import BigNumber from 'bignumber.js'
import { PoolPairData, PoolSwapData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { Ocean, sendToS3, sendToS3Full } from './utils/helpers'
import { LoanToken, LoanVaultActive } from '@defichain/whale-api-client/dist/api/loan'
import fetch from 'cross-fetch'
import { LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'


class DUSDVolume {
  public address
  public buying = new BigNumber(0)
  public selling = new BigNumber(0)

  constructor(address: string) {
    this.address = address
  }
}

const bigDFIThreshold = 50000

class DFIVolume {
  public symbol
  public totalBuying = new BigNumber(0)
  public totalSelling = new BigNumber(0)
  public buyingFromBigSwaps = new BigNumber(0)
  public sellingFromBigSwaps = new BigNumber(0)

  constructor(symbol: string) {
    this.symbol = symbol
  }

  public toJson(): Object {
    return {
      symbol: this.symbol,
      totalBuying: this.totalBuying.toNumber(),
      totalSelling: this.totalSelling.toNumber(),
      buyingFromBigSwaps: this.buyingFromBigSwaps.toNumber(),
      sellingFromBigSwaps: this.sellingFromBigSwaps.toNumber(),
    }
  }
}


class TokenData {
  public key: string
  public minted: BigNumber
  public fsminted: BigNumber = new BigNumber(0)
  public fsburned: BigNumber = new BigNumber(0)
  public openloan: BigNumber = new BigNumber(0)
  public openinterest: BigNumber = new BigNumber(0)
  public burned: BigNumber = new BigNumber(0)
  public frompayback: BigNumber = new BigNumber(0)
  public price: BigNumber

  constructor(key: string, minted: string | number, price: string | number) {
    this.key = key
    this.minted = new BigNumber(minted)
    this.price = new BigNumber(price)
  }

  public toJson(): Object {
    return {
      key: this.key,
      minted: {
        chainReported: this.minted.toNumber(),
        futureswap: this.fsminted.toNumber(),
        loans: this.openloan.toNumber(),
        dfipayback: this.frompayback.toNumber(),
      },
      burn: {
        futureswap: this.fsburned.toNumber(),
        other: this.burned.toNumber(),
      },
      openinterest: this.openinterest.toNumber(),
      price: this.price.toNumber(),
    }
  }
}

class YieldForToken {
  public paidCommission = new BigNumber(0)
  public fee = new BigNumber(0)
  public totalyieldusdValue = new BigNumber(0)
  public token: string
  public totalCoinsInPools = new BigNumber(0)
  public totalUSDInPools = new BigNumber(0)

  constructor(token: string) {
    this.token = token
  }

  public toString(): string {
    return `${this.token}: ${this.paidCommission.toFixed(4)} comm, ${this.fee.toFixed(4)} fee`
  }
}

async function getSwaps(o: Ocean, id: string, untilBlock: number): Promise<PoolSwapData[]> {
  let lastResult = await o.c.poolpairs.listPoolSwapsVerbose(id, 20)
  const pages = [lastResult]
  while (lastResult.hasNext && lastResult[lastResult.length - 1].block.height > untilBlock) {
    try {
      lastResult = await o.c.poolpairs.listPoolSwapsVerbose(id, 20, lastResult.nextToken)
      pages.push(lastResult)
    } catch (e) {
      break
    }
  }

  return pages.flatMap((page) => page as PoolSwapData[])
}

function inFeeA(pool: PoolPairData): number {
  return +(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)
}

function outFeeA(pool: PoolPairData): number {
  return +(pool.tokenA.fee?.outPct ?? pool.tokenA.fee?.pct ?? 0)
}

function inFeeB(pool: PoolPairData): number {
  return +(pool.tokenB.fee?.inPct ?? pool.tokenB.fee?.pct ?? 0)
}

function outFeeB(pool: PoolPairData): number {
  return +(pool.tokenB.fee?.outPct ?? pool.tokenB.fee?.pct ?? 0)
}

class DataWindow {
  public startHeight: number
  public endHeight: number
  public refDate: Date
  public filename: string

  public dusdVolumes: Map<string, DUSDVolume> = new Map()
  public dfiVolumes: Map<string, DFIVolume> = new Map()
  public yields: Map<string, YieldForToken> = new Map()

  public constructor(startHeight: number, endHeight: number, refDate: Date, filename: string) {
    this.startHeight = startHeight
    this.endHeight = endHeight
    this.refDate = refDate
    this.filename = filename
  }
}

export async function main(event: any, context: any): Promise<Object> {
  console.log('real yield calculator')
  const o = new Ocean()
  const currentHeight = (await o.c.stats.get()).count.blocks
  const lateststartHeight = currentHeight
  const latestanalysisWindow = 2880
  const latestendHeight = lateststartHeight - latestanalysisWindow
  const latesttime = (await o.c.blocks.get(lateststartHeight.toString())).time

  //prepare windows:
  const windows: DataWindow[] = []
  //first entry is latest
  windows.push(new DataWindow(lateststartHeight, latestendHeight, new Date(latesttime * 1000), "latest"))
  //always add current day
  const date = new Date(latesttime * 1000)
  date.setUTCHours(0, 0, 0, 0)
  const tstampStart = date.getTime() / 1000
  const dayStart = await o.getBlockForTstamp(tstampStart, { height: currentHeight, tstamp: latesttime })
  const refDate = new Date((latesttime + tstampStart) * 1000 / 2)
  windows.push(new DataWindow(lateststartHeight, dayStart, refDate, refDate.toISOString().substring(0, 10)))
  //if current day is max 4 hours old -> also add previous day
  if (latesttime - dayStart < 60 * 60 * 4) {
    const prevStart = await o.getBlockForTstamp(tstampStart - 60 * 60 * 24, { height: dayStart, tstamp: tstampStart })
    const refDate = new Date((prevStart + dayStart) * 1000 / 2)
    windows.push(new DataWindow(dayStart, prevStart, refDate, refDate.toISOString().substring(0, 10)))
  }


  const totalEnd = windows.map(w => w.endHeight).reduce((a, b) => Math.min(a, b), currentHeight)
  const totalStart = windows.map(w => w.startHeight).reduce((a, b) => Math.max(a, b), 0)
  console.log(
    'starting at block ' +
    totalStart +
    ' analysing down until ' +
    totalEnd +
    ' for date ' +
    latesttime.toFixed(0) +
    ' ' +
    new Date(latesttime * 1000).toISOString() +
    " doing " + windows.length + " windows: " + windows.map(w => w.filename + ": " + w.startHeight + " to " + w.endHeight).toString(),
  )
  //read all vaults
  const pools = await o.getAll(() => o.c.poolpairs.list(200))

  const gatewaypools = ['DUSD-DFI', 'USDT-DUSD', 'USDC-DUSD', 'EUROC-DUSD']
  const activePools = pools.filter((p) => p.status && +p.totalLiquidity.token > 0)
  console.log('getting swaps for ' + activePools.length + ' pools')
  for (const pool of activePools) {
    windows.forEach(window => {

      if (!window.yields.has(pool.tokenA.symbol)) {
        window.yields.set(pool.tokenA.symbol, new YieldForToken(pool.tokenA.symbol))
      }
      const dataA = window.yields.get(pool.tokenA.symbol)!
      dataA.totalCoinsInPools = dataA.totalCoinsInPools.plus(pool.tokenA.reserve)
      if (!window.yields.has(pool.tokenB.symbol)) {
        window.yields.set(pool.tokenB.symbol, new YieldForToken(pool.tokenB.symbol))
      }
      const dataB = window.yields.get(pool.tokenB.symbol)!
      dataB.totalCoinsInPools = dataB.totalCoinsInPools.plus(pool.tokenB.reserve)

    })
    const swaps = await getSwaps(o, pool.id, totalEnd)
    for (const swap of swaps) {
      if (swap.block.height > totalStart) {
        continue
      }
      if (swap.block.height < totalEnd) {
        break
      }
      const usedWindows = windows.filter(w => w.startHeight > swap.block.height && w.endHeight <= swap.block.height)
      if (usedWindows.length == 0) {
        continue
      }

      let amountA: BigNumber | undefined = undefined
      let amountB: BigNumber | undefined = undefined
      let AtoB = true
      if (swap.fromTokenId == +pool.tokenA.id) {
        amountA = new BigNumber(swap.fromAmount)
        AtoB = true
      }
      if (swap.fromTokenId == +pool.tokenB.id) {
        amountB = new BigNumber(swap.fromAmount)
        AtoB = false
      }

      //outAmount = swapResult * (1-outPct)
      //outFee = outAmount* outPct/(1-outPct)
      if (swap.to?.symbol == pool.tokenA.symbol) {
        amountA = new BigNumber(swap.to.amount)
        AtoB = false
      }
      if (swap.to?.symbol == pool.tokenB.symbol) {
        amountB = new BigNumber(swap.to.amount)
        AtoB = true
      }

      //estimations
      //got none-> estimate from and to will follow afterwards
      if (amountA === undefined && amountB === undefined) {
        if (swap.from !== undefined && swap.type !== undefined) {
          AtoB = swap.type === 'SELL'
          //swap type BUY means token A of pool is bought
          let poolSymbolFrom = swap.from.symbol + '-' + (!AtoB ? pool.tokenB.symbol : pool.tokenA.symbol)
          let poolFrom = pools.find((p) => p.symbol === poolSymbolFrom)
          let fromAtoB = true
          if (poolFrom === undefined) {
            poolSymbolFrom = (!AtoB ? pool.tokenB.symbol : pool.tokenA.symbol) + '-' + swap.from.symbol
            poolFrom = pools.find((p) => p.symbol === poolSymbolFrom)
            fromAtoB = false
          }
          if (poolFrom !== undefined) {
            let myFrom = new BigNumber(swap.from.amount)
              .times(1 - +poolFrom.commission)
              .times(1 - (fromAtoB ? inFeeA(poolFrom) : inFeeB(poolFrom)))
              .times(fromAtoB ? poolFrom.priceRatio.ba : poolFrom.priceRatio.ab)
              .times(1 - (fromAtoB ? outFeeB(poolFrom) : outFeeA(poolFrom)))
            if (AtoB) {
              amountA = myFrom
            } else {
              amountB = myFrom
            }
            //TODO: could estimate the other side based on the output with same logic, not sure what is more accurate, probably the same
          } else {
            console.warn(
              'unable to find other pools for 3-way swap: ' +
              swap.from.symbol +
              '->' +
              swap.to?.symbol +
              ' in pool ' +
              pool.symbol +
              ' type ' +
              swap.type,
            )
          }
        }
      }
      // got one, but not the other
      if (amountB === undefined && amountA !== undefined) {
        if (AtoB) {
          amountB = amountA
            .times(1 - inFeeA(pool))
            .times(1 - +pool.commission)
            .times(pool.priceRatio.ba)
            .times(1 - outFeeB(pool)) //also apply outFee here, for simplicity we assume amountB to be the result of the total swap
        } else {
          amountB = amountA
            .div(1 - outFeeA(pool))
            .div(1 - +pool.commission)
            .div(pool.priceRatio.ab)
            .div(1 - inFeeB(pool))
        }
      }
      if (amountA === undefined && amountB !== undefined) {
        if (AtoB) {
          amountA = amountB
            .div(1 - outFeeB(pool))
            .div(pool.priceRatio.ba)
            .div(1 - +pool.commission)
            .div(1 - inFeeA(pool))
        } else {
          amountA = amountB
            .times(1 - inFeeB(pool))
            .times(1 - +pool.commission)
            .times(pool.priceRatio.ab)
            .times(1 - outFeeA(pool)) //also apply outFee here, for simplicity we assume amountB to be the result of the total swap
        }
      }

      usedWindows.forEach(window => {

        if (amountA !== undefined && amountB !== undefined) {
          const dataA = window.yields.get(pool.tokenA.symbol)!
          const dataB = window.yields.get(pool.tokenB.symbol)!
          if (AtoB) {
            const inFee = inFeeA(pool)
            const outFee = outFeeB(pool)
            const commission = amountA.multipliedBy(pool.commission)
            dataA.paidCommission = dataA.paidCommission.plus(commission)
            if (inFee > 0) {
              dataA.fee = dataA.fee.plus(amountA.minus(commission).multipliedBy(inFeeA(pool)))
            }
            if (outFee > 0) {
              dataB.fee = dataB.fee.plus(amountB.multipliedBy(outFee).dividedBy(new BigNumber(1).minus(outFee)))
            }
          } else {
            const inFee = inFeeB(pool)
            const outFee = outFeeA(pool)
            const commission = amountB.multipliedBy(pool.commission)
            dataB.paidCommission = dataB.paidCommission.plus(commission)
            if (inFee > 0) {
              dataB.fee = dataB.fee.plus(amountB.minus(commission).multipliedBy(inFee))
            }
            if (outFee > 0) {
              dataA.fee = dataA.fee.plus(amountA.multipliedBy(outFee).dividedBy(new BigNumber(1).minus(outFee)))
            }
          }
        }
        if (gatewaypools.indexOf(pool.symbol) > -1) {
          const buying = (pool.tokenA.symbol === 'DUSD' && !AtoB) || (pool.tokenB.symbol === 'DUSD' && AtoB)
          const amountDUSD = pool.tokenA.symbol === 'DUSD' ? amountA : amountB
          const owner = swap.from?.address
          if (owner && amountDUSD) {
            if (!window.dusdVolumes.has(owner)) {
              window.dusdVolumes.set(owner, new DUSDVolume(owner))
            }
            const data = window.dusdVolumes.get(owner)!
            if (buying) {
              data.buying = data.buying.plus(amountDUSD)
            } else {
              data.selling = data.selling.plus(amountDUSD)
            }
          }
        }
        if (pool.tokenB.symbol === "DFI" && pool.tokenA.symbol !== "DUSD") {
          /// DFI pool, but not DUSD gateway
          const buying = AtoB
          const symbol = pool.tokenA.symbol
          if (!window.dfiVolumes.has(symbol)) {
            window.dfiVolumes.set(symbol, new DFIVolume(symbol))
          }
          const data = window.dfiVolumes.get(symbol)!
          if (amountB) {
            if (buying) {
              data.totalBuying = data.totalBuying.plus(amountB)
              if (amountB.gt(bigDFIThreshold)) {
                data.buyingFromBigSwaps = data.buyingFromBigSwaps.plus(amountB)
              }
            } else {
              data.totalSelling = data.totalSelling.plus(amountB)
              if (amountB.gt(bigDFIThreshold)) {
                data.sellingFromBigSwaps = data.sellingFromBigSwaps.plus(amountB)
              }
            }
          }
        }
      })
    }
  }

  const prices = await o.getAll(() => o.c.prices.list())
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i]
    console.log("doing window " + window.filename + " " + window.startHeight + " - " + window.endHeight)
    {
      let totalCommission = new BigNumber(0)
      let totalFee = new BigNumber(0)
      prices.forEach((p) => {
        if (window.yields.has(p.price.token)) {
          const data = window.yields.get(p.price.token)!
          data.totalyieldusdValue = data.fee.plus(data.paidCommission).times(p.price.aggregated.amount)
          data.totalUSDInPools = data.totalCoinsInPools.times(p.price.aggregated.amount)
          totalCommission = totalCommission.plus(data.paidCommission.times(p.price.aggregated.amount))
          totalFee = totalFee.plus(data.fee.times(p.price.aggregated.amount))
        }
      })

      //DUSD needs to be done manually (no oracle price)

      const data = window.yields.get('DUSD')!
      data.totalyieldusdValue = data?.fee.plus(data.paidCommission)
      totalCommission = totalCommission.plus(data.paidCommission)
      totalFee = totalFee.plus(data.fee)

      const result = {
        meta: {
          tstamp: window.refDate.toISOString(),
          startHeight: window.endHeight,
          endHeight: window.startHeight,
        },
        totalUSD: {
          commission: totalCommission.decimalPlaces(8).toNumber(),
          fee: totalFee.decimalPlaces(8).toNumber(),
        },
        tokens: Object(),
      }
      window.yields.forEach((v, k) => {
        const total = v.fee.plus(v.paidCommission)
        result.tokens[v.token] = {
          commission: v.paidCommission.decimalPlaces(8).toNumber(),
          fee: v.fee.decimalPlaces(8).toNumber(),
          usdValue: v.totalyieldusdValue.decimalPlaces(8).toNumber(),
          feeInUSD: total.gt(0) ? v.totalyieldusdValue.times(v.fee).div(total).decimalPlaces(8).toNumber() : 0,
          commissionInUSD: total.gt(0)
            ? v.totalyieldusdValue.times(v.paidCommission).div(total).decimalPlaces(8).toNumber()
            : 0,
          totalCoinsInPools: v.totalCoinsInPools.decimalPlaces(8).toNumber(),
          totatUSDInPools: v.totalUSDInPools.decimalPlaces(8).toNumber(),
        }
      })

      console.log('total ' + totalCommission.toFixed(2) + '$ comm + ' + totalFee.toFixed(2) + '$ fees')
      await sendToS3(result, window.filename + '.json')
      console.log(JSON.stringify(result))
    }
    {
      // dusd volumes:
      console.log('analyzing DUSD data')
      const dusdBots = [
        'df1q0ulwgygkg0lwk5aaqfkmkx7jrvf4zymj0yyfef',
        'df1qlwvtdrh4a4zln3k56rqnx8chu8t0sqx36syaea',
        'df1qa6qjmtuh8fyzqyjjsrg567surxu43rx3na7yah',
      ]

      const cakeYV = [
        'df1qysxzf9hzn6kql0zs9hmfyewln06akqvwe5u3c9',
        'df1qxv0q27mvxqznzu36l7lvdzm7p26y8gwkeqhy3m',
        'df1qycert2awhxp4n74vs25u7thyplua55gx624xaf',
        'df1q8v6m62997petdz0dzdeu2xg03sq87e768tpv6l',
        'df1qpzrg4q04kh29fu88gxx2766mpkd6vchtvnn6n4',
        'df1qyehja923547nqmfgaeduvus5fgumlzv80068rr',
      ]

      const organic = new DUSDVolume('organic')
      const bots = new DUSDVolume('bots')
      window.dusdVolumes.forEach((volume, address) => {
        if (dusdBots.indexOf(address) > -1 || cakeYV.indexOf(address) > -1) {
          bots.buying = bots.buying.plus(volume.buying)
          bots.selling = bots.selling.plus(volume.selling)
        } else {
          organic.buying = organic.buying.plus(volume.buying)
          organic.selling = organic.selling.plus(volume.selling)
        }
      })

      const dusdResult = {
        meta: {
          tstamp: window.refDate.toISOString(),
          startHeight: window.endHeight,
          endHeight: window.startHeight,
        },
        bots: {
          buying: bots.buying.toNumber(),
          selling: bots.selling.toNumber(),
        },
        organic: {
          buying: organic.buying.toNumber(),
          selling: organic.selling.toNumber(),
        },
      }

      await sendToS3Full(dusdResult, 'dusdVolumes/', window.filename + '.json')
      console.log(JSON.stringify(dusdResult))

      if (window.startHeight == lateststartHeight && window.endHeight == latestendHeight) {
        //dToken analysis
        await runDTokenAnalysis(o, lateststartHeight, latestendHeight, window.refDate, bots, organic)

      }
    }

    {

      console.log("uploading DFI volumes")
      const dfiData: Object[] = []
      window.dfiVolumes.forEach((volume, coin) => {
        dfiData.push(volume.toJson())
      })
      const dfiResult = {
        meta: {
          tstamp: window.refDate.toISOString(),
          startHeight: window.endHeight,
          endHeight: window.startHeight,
          analysedAt: currentHeight
        },
        dfiVolume: dfiData
      }
      await sendToS3Full(dfiResult, 'dfiVolumes/', window.filename + '.json')
      console.log(JSON.stringify(dfiResult))
    }
  }
  return { statusCode: 200 }
}

async function runDTokenAnalysis(o: Ocean, startHeight: number, endHeight: number, date: Date, dusdBots: DUSDVolume, dusdOrganic: DUSDVolume): Promise<void> {

  console.log('reading dToken data')

  const splitMultipliers: { [keys: string]: number } = { 'TSLA/v1': 3, 'GME/v1': 4, 'GOOGL/v1': 20, 'AMZN/v1': 20 }

  const oceantokens = await o.getAll(() => o.c.loan.listLoanToken(200))
  const loantokens: Map<string, TokenData> = new Map()
  for (const lt of oceantokens) {
    loantokens.set(
      lt.token.symbolKey,
      new TokenData(
        lt.token.symbolKey,
        lt.token.minted,
        lt.activePrice?.active?.amount ?? (lt.token.symbolKey === 'DUSD' ? 1 : 0),
      ),
    )
  }

  await analyzeFS(loantokens)

  await analyzeBurn(o, loantokens)

  await anaylzeVaults(o, loantokens)

  const filtered: TokenData[] = []
  loantokens.forEach((data, key) => {
    if (key.indexOf('/') > -1 && splitMultipliers[key] != undefined) {
      //is split token
      const parts = key.split('/')
      const multi = splitMultipliers[key]
      const token = parts[0]
      if (loantokens.has(token)) {
        const otherData = loantokens.get(token)
        if (otherData) {
          otherData.burned = otherData.burned.plus(data.burned.times(multi))
          otherData.fsminted = otherData.fsminted.plus(data.fsminted.times(multi))
          otherData.fsburned = otherData.fsburned.plus(data.fsburned.times(multi))
        }
        data.minted = new BigNumber(0)
      }
    }
    if (data.minted.gt(0)) {
      filtered.push(data)
    }
  })

  const dTokenData = {
    meta: {
      tstamp: date.toISOString(),
      startHeight: endHeight,
      endHeight: startHeight,
      analysedAt: startHeight,
    },
    dusdVolume: {
      bots: {
        buying: dusdBots.buying.toNumber(),
        selling: dusdBots.selling.toNumber(),
      },
      organic: {
        buying: dusdOrganic.buying.toNumber(),
        selling: dusdOrganic.selling.toNumber(),
      },
    },
    dTokens: filtered.map((d) => d.toJson()),
  }

  const day = date.toISOString().substring(0, 10)
  await sendToS3Full(dTokenData, 'dToken/', day + '.json')
  await sendToS3Full(dTokenData, 'dToken/', 'latest.json')
  console.log(JSON.stringify(dTokenData))
}

async function analyzeFS(loantokens: Map<string, TokenData>): Promise<void> {
  const response = await fetch('http://api.mydefichain.com/v1/listgovs/')
  const govs = await response.json()

  let burned = []
  let minted = []
  for (const gov of govs) {
    const attr = gov.find((e: any) => e.ATTRIBUTES != undefined)
    if (attr != undefined) {
      burned = attr.ATTRIBUTES['v0/live/economy/dfip2203_burned']
      minted = attr.ATTRIBUTES['v0/live/economy/dfip2203_minted']
    }
  }

  minted.forEach((mint: string) => {
    const [amount, token] = mint.split('@')
    if (!loantokens.has(token)) {
      loantokens.set(token, new TokenData(token, 0, 0))
    }
    const data = loantokens.get(token)!
    data.fsminted = data.fsminted.plus(amount)
  })

  burned.forEach((burn: string) => {
    const [amount, token] = burn.split('@')
    if (!loantokens.has(token)) {
      loantokens.set(token, new TokenData(token, 0, 0))
    }
    const data = loantokens.get(token)!
    data.fsburned = data.fsburned.plus(amount)
  })
}

async function analyzeBurn(o: Ocean, loantokens: Map<string, TokenData>): Promise<void> {
  const burn = await o.c.stats.getBurn()

  burn.dfipaybacktokens.forEach((b) => {
    const [amount, token] = b.split('@')
    if (!loantokens.has(token)) {
      loantokens.set(token, new TokenData(token, 0, 0))
    }
    const data = loantokens.get(token)!
    data.frompayback = data.frompayback.plus(amount)
  })

  burn.dexfeetokens.forEach((b) => {
    const [amount, token] = b.split('@')
    if (!loantokens.has(token)) {
      loantokens.set(token, new TokenData(token, 0, 0))
    }
    const data = loantokens.get(token)!
    data.burned = data.burned.plus(amount)
  })

  burn.paybackburntokens.forEach((b) => {
    const [amount, token] = b.split('@')
    if (!loantokens.has(token)) {
      loantokens.set(token, new TokenData(token, 0, 0))
    }
    const data = loantokens.get(token)!
    data.burned = data.burned.plus(amount)
  })
}

async function anaylzeVaults(o: Ocean, loantokens: Map<string, TokenData>): Promise<void> {
  const vaults = await o.getAll(() => o.c.loan.listVault(200))
  vaults
    .filter((v) => v.state === LoanVaultState.ACTIVE)
    .map((v) => v as LoanVaultActive)
    .forEach((v) => {
      v.loanAmounts.forEach((loan) => {
        const token = loan.symbolKey
        const amount = loan.amount
        if (!loantokens.has(token)) {
          loantokens.set(token, new TokenData(token, 0, 0))
        }
        const data = loantokens.get(token)!
        data.openloan = data.openloan.plus(amount)
      })
      v.interestAmounts.forEach((interest) => {
        const token = interest.symbolKey
        const amount = interest.amount
        if (!loantokens.has(token)) {
          loantokens.set(token, new TokenData(token, 0, 0))
        }
        const data = loantokens.get(token)!
        data.openloan = data.openloan.minus(amount)
        data.openinterest = data.openinterest.plus(amount)
      })
    })
}
