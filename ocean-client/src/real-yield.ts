import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import BigNumber from 'bignumber.js'
import { PoolPairData, PoolSwapData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { sendToS3, sendToS3Full } from './utils/helpers'

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
    while (pages[pages.length - 1].hasNext && (maxAmount < 0 || total > maxAmount)) {
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

class DUSDVolume {
  public address
  public buying= new BigNumber(0)
  public selling= new BigNumber(0)
  
  constructor(address: string) {
    this.address = address
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

export async function main(event: any, context: any): Promise<Object> {
  console.log('real yield calculator')
  const o = new Ocean()
  const isHistoryCall= event != undefined && event["startHeight"] != undefined
  const startHeight= isHistoryCall? event["startHeight"] : (await o.c.stats.get()).count.blocks
  const analysisWindow = 2880
  const endHeight = startHeight - analysisWindow
  const time= (await o.c.blocks.get(startHeight)).time
  const date= new Date(time*1000)

  console.log('starting at block ' + startHeight + ' analysing down until ' + endHeight+ " for date "+time.toFixed(0)+" "+date.toISOString())
  //read all vaults
  const pools = await o.getAll(() => o.c.poolpairs.list(200))

  const gatewaypools= ["DUSD-DFI","USDT-DUSD","USDC-DUSD","EUROC-DUSD"]

  const dusdVolumes: Map<string,DUSDVolume> = new Map()

  const activePools = pools.filter((p) => p.status && +p.totalLiquidity.token > 0)
  console.log('getting swaps for ' + activePools.length + ' pools')
  const yields: Map<string, YieldForToken> = new Map()
  for (const pool of activePools) {
    if (!yields.has(pool.tokenA.symbol)) {
      yields.set(pool.tokenA.symbol, new YieldForToken(pool.tokenA.symbol))
    }
    const dataA = yields.get(pool.tokenA.symbol)!
    dataA.totalCoinsInPools = dataA.totalCoinsInPools.plus(pool.tokenA.reserve)
    if (!yields.has(pool.tokenB.symbol)) {
      yields.set(pool.tokenB.symbol, new YieldForToken(pool.tokenB.symbol))
    }
    const dataB = yields.get(pool.tokenB.symbol)!
    dataB.totalCoinsInPools = dataB.totalCoinsInPools.plus(pool.tokenB.reserve)

    const swaps = await getSwaps(o, pool.id, endHeight)
    for (const swap of swaps) {
      if (swap.block.height > startHeight) {
        continue
      }
      if (swap.block.height < endHeight) {
        break
      }
      let amountA = undefined
      let amountB = undefined
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
      if (amountA !== undefined && amountB !== undefined) {
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
          if (!dusdVolumes.has(owner)) {
            dusdVolumes.set(owner,new DUSDVolume(owner))
          }
          const data = dusdVolumes.get(owner)!
          if (buying) {
            data.buying = data.buying.plus(amountDUSD)
          } else {
            data.selling = data.selling.plus(amountDUSD)
          }
        }
      }
    }
  }

  const prices = await o.getAll(() => o.c.prices.list())
  let totalCommission = new BigNumber(0)
  let totalFee = new BigNumber(0)
  prices.forEach((p) => {
    if (yields.has(p.price.token)) {
      const data = yields.get(p.price.token)!
      data.totalyieldusdValue = data.fee.plus(data.paidCommission).times(p.price.aggregated.amount)
      data.totalUSDInPools = data.totalCoinsInPools.times(p.price.aggregated.amount)
      totalCommission = totalCommission.plus(data.paidCommission.times(p.price.aggregated.amount))
      totalFee = totalFee.plus(data.fee.times(p.price.aggregated.amount))
    }
  })

  //DUSD needs to be done manually (no oracle price)

  const data = yields.get('DUSD')!
  data.totalyieldusdValue = data?.fee.plus(data.paidCommission)
  totalCommission = totalCommission.plus(data.paidCommission)
  totalFee = totalFee.plus(data.fee)

  const result = {
    meta: {
      tstamp: date.toISOString(),
      startHeight: endHeight,
      endHeight: startHeight,
    },
    totalUSD: {
      commission: totalCommission.decimalPlaces(8).toNumber(),
      fee: totalFee.decimalPlaces(8).toNumber(),
    },
    tokens: Object(),
  }
  yields.forEach((v, k) => {
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

  const day = date.toISOString().substring(0, 10)
  await sendToS3(result, day + '.json')
  if(!isHistoryCall){
  await sendToS3(result, 'latest.json')
  }
  console.log(JSON.stringify(result))

  // dusd volumes:

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

  const organic= new DUSDVolume("organic")
  const bots = new DUSDVolume("bots")
  dusdVolumes.forEach((volume,address) => {
    if (dusdBots.indexOf(address) > -1 || cakeYV.indexOf(address) > -1) {
      bots.buying= bots.buying.plus(volume.buying)
      bots.selling = bots.selling.plus(volume.selling)
    } else {
      organic.buying= organic.buying.plus(volume.buying)
      organic.selling = organic.selling.plus(volume.selling)
    }
  })

  const dusdResult= {    
    meta: {
      tstamp: date.toISOString(),
      startHeight: endHeight,
      endHeight: startHeight,
    },
    bots: {
      buying: bots.buying,
      selling: bots.selling
    },
    organic: {
      buying: organic.buying,
      selling: organic.selling
    }
  }

  await sendToS3Full(dusdResult, "dusdVolumes/", day + '.json')
  if(!isHistoryCall){
    await sendToS3Full(dusdResult, "dusdVolumes/",'latest.json')
  }
  console.log(JSON.stringify(dusdResult))

  return { statusCode: 200 }
}
