import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import BigNumber from 'bignumber.js'
import { PoolSwapData } from '@defichain/whale-api-client/dist/api/poolpairs'
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

class YieldForToken {
  public paidCommission = new BigNumber(0)
  public fee = new BigNumber(0)
  public usdValue = new BigNumber(0)
  public token: string

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

export async function main(event: any, context: any): Promise<Object> {
  console.log('real yield calculator')
  const o = new Ocean()
  const startHeight = (await o.c.stats.get()).count.blocks
  const analysisWindow = 2880
  const endHeight = startHeight - analysisWindow
  console.log('starting at block ' + startHeight + ' analysing down until ' + endHeight)
  //read all vaults
  const pools = await o.getAll(() => o.c.poolpairs.list(200))

  const activePools = pools.filter((p) => p.status && +p.totalLiquidity.token > 0)
  console.log('getting swaps for ' + activePools.length + ' pools')
  const yields: Map<string, YieldForToken> = new Map()
  for (const pool of activePools) {
    console.debug('processing pool ' + pool.symbol)
    if (!yields.has(pool.tokenA.symbol)) {
      yields.set(pool.tokenA.symbol, new YieldForToken(pool.tokenA.symbol))
    }
    const dataA = yields.get(pool.tokenA.symbol)!
    if (!yields.has(pool.tokenB.symbol)) {
      yields.set(pool.tokenB.symbol, new YieldForToken(pool.tokenB.symbol))
    }
    const dataB = yields.get(pool.tokenB.symbol)!

    const swaps = await getSwaps(o, pool.id, endHeight)
    console.debug('got ' + swaps.length + ' swaps to process')
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
        const amount = new BigNumber(swap.fromAmount)
        const fee = new BigNumber(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)
        dataA.fee = dataA.fee.plus(amount.multipliedBy(fee))
        dataA.paidCommission = dataA.paidCommission.plus(amount.multipliedBy(pool.commission))
        amountA = amount
      }
      if (swap.fromTokenId == +pool.tokenB.id) {
        const amount = new BigNumber(swap.fromAmount)
        const fee = new BigNumber(pool.tokenB.fee?.inPct ?? pool.tokenB.fee?.pct ?? 0)
        dataB.fee = dataB.fee.plus(amount.multipliedBy(fee))
        dataB.paidCommission = dataB.paidCommission.plus(amount.multipliedBy(pool.commission))
        amountB = amount
        AtoB = false
      }

      //outAmount = swapResult * (1-outPct)
      //outFee = outAmount* outPct/(1-outPct)
      if (swap.to?.symbol == pool.tokenA.symbol) {
        const amount = new BigNumber(swap.to.amount)
        const fee = new BigNumber(pool.tokenA.fee?.outPct ?? pool.tokenA.fee?.pct ?? 0)
        dataA.fee = dataA.fee.plus(amount.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
        amountA = amount
        AtoB = false
      }
      if (swap.to?.symbol == pool.tokenB.symbol) {
        const amount = new BigNumber(swap.to.amount)
        const fee = new BigNumber(pool.tokenB.fee?.outPct ?? pool.tokenB.fee?.pct ?? 0)
        dataB.fee = dataB.fee.plus(amount.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
        amountB = amount
      }

      //estimations
      // got one, but not the other
      if (amountB === undefined && amountA !== undefined) {
        amountB = amountA.multipliedBy(pool.priceRatio.ba)
        if (AtoB) {
          amountB = amountB
            .times(1 - +pool.commission)
            .times(1 - +(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)) //reduced by fee
          const fee = new BigNumber(pool.tokenB.fee?.outPct ?? pool.tokenB.fee?.pct ?? 0)
          dataB.fee = dataB.fee.plus(amountB.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
        } else {
          amountB = amountB.div(1 - +pool.commission).div(1 - +(pool.tokenA.fee?.outPct ?? pool.tokenA.fee?.pct ?? 0)) //result already reduced by fee
          const fee = new BigNumber(pool.tokenB.fee?.inPct ?? pool.tokenB.fee?.pct ?? 0)
          dataB.fee = dataB.fee.plus(amountB.multipliedBy(fee))
          dataB.paidCommission = dataB.paidCommission.plus(amountB.multipliedBy(pool.commission))
        }
      }
      if (amountA === undefined && amountB !== undefined) {
        amountA = amountB.multipliedBy(pool.priceRatio.ab)
        if (AtoB) {
          amountA = amountA.div(1 - +pool.commission).div(1 - +(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)) //result already reduced by fee
          const fee = new BigNumber(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)
          dataA.fee = dataA.fee.plus(amountA.multipliedBy(fee))
          dataA.paidCommission = dataA.paidCommission.plus(amountA.multipliedBy(pool.commission))
        } else {
          amountA = amountA
            .times(1 - +pool.commission)
            .times(1 - +(pool.tokenB.fee?.inPct ?? pool.tokenB.fee?.pct ?? 0)) //reduced by fee
          const fee = new BigNumber(pool.tokenA.fee?.outPct ?? pool.tokenA.fee?.pct ?? 0)
          dataA.fee = dataA.fee.plus(amountA.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
        }
      }
      if (amountA === undefined && amountB === undefined) {
        if (swap.to !== undefined && swap.from !== undefined && swap.type !== undefined) {
          //swap type BUY means token A of pool is bought
          let poolSymbolFrom = swap.from.symbol + '-' + (swap.type === 'BUY' ? pool.tokenB.symbol : pool.tokenA.symbol)
          let poolFrom = pools.find((p) => p.symbol === poolSymbolFrom)
          let fromAtoB = true
          if (poolFrom === undefined) {
            poolSymbolFrom = (swap.type === 'BUY' ? pool.tokenB.symbol : pool.tokenA.symbol) + '-' + swap.from.symbol
            poolFrom = pools.find((p) => p.symbol === poolSymbolFrom)
            fromAtoB = false
          }
          if (poolFrom !== undefined) {
            let myFrom = new BigNumber(swap.from.amount)
              .times(1 - +((fromAtoB ? poolFrom.tokenA.fee?.inPct : poolFrom.tokenB.fee?.inPct) ?? 0))
              .times(fromAtoB ? poolFrom.priceRatio.ba : poolFrom.priceRatio.ab)
              .times(1 - +((fromAtoB ? poolFrom.tokenB.fee?.outPct : poolFrom.tokenA.fee?.outPct) ?? 0))
              .times(1 - +poolFrom.commission)

            amountA = swap.type === 'BUY' ? myFrom.times(pool.priceRatio.ab) : myFrom
            amountB = myFrom.multipliedBy(pool.priceRatio.ba)
            if (swap.type !== 'BUY') {
              let fee = new BigNumber(pool.tokenB.fee?.outPct ?? pool.tokenB.fee?.pct ?? 0)
              dataB.fee = dataB.fee.plus(amountB.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))

              fee = new BigNumber(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)
              dataA.fee = dataA.fee.plus(amountA.multipliedBy(fee))
              dataA.paidCommission = dataA.paidCommission.plus(amountA.multipliedBy(pool.commission))
            } else {
              let fee = new BigNumber(pool.tokenB.fee?.inPct ?? pool.tokenB.fee?.pct ?? 0)
              dataB.fee = dataB.fee.plus(amountB.multipliedBy(fee))
              dataB.paidCommission = dataB.paidCommission.plus(amountB.multipliedBy(pool.commission))

              fee = new BigNumber(pool.tokenA.fee?.outPct ?? pool.tokenA.fee?.pct ?? 0)
              dataA.fee = dataA.fee.plus(amountA.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
            }
            /*
              console.log(
                'got 3 way swap: ' +
                  JSON.stringify(swap) +
                  '\n' +
                  'assuming swap ' +
                  swap.from.amount +
                  '@' +
                  swap.from.symbol +
                  '->' +
                  myFrom.toFixed(8) +
                  '@' +
                  (swap.type === 'BUY' ? pool.tokenB.symbol : pool.tokenA.symbol) +
                  '->' +
                  (swap.type === 'BUY'
                    ? amountA.toFixed(8) + '@' + pool.tokenA.symbol
                    : amountB.toFixed(8) + '@' + pool.tokenB.symbol),
              )
              //*/
          } else {
            console.warn(
              'unable to find other pools for 3-way swap: ' +
                swap.from.symbol +
                '->' +
                swap.to.symbol +
                ' in pool ' +
                pool.symbol +
                ' type ' +
                swap.type,
            )
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
      data.usdValue = data?.fee.plus(data.paidCommission).times(p.price.aggregated.amount)
      totalCommission = totalCommission.plus(data.paidCommission.times(p.price.aggregated.amount))
      totalFee = totalFee.plus(data.fee.times(p.price.aggregated.amount))
    }
  })

  //DUSD needs to be done manually (no oracle price)

  const data = yields.get('DUSD')!
  data.usdValue = data?.fee.plus(data.paidCommission)
  totalCommission = totalCommission.plus(data.paidCommission)
  totalFee = totalFee.plus(data.fee)

  const result = {
    meta: {
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
    result.tokens[v.token] = {
      commission: v.paidCommission.decimalPlaces(8).toNumber(),
      fee: v.fee.decimalPlaces(8).toNumber(),
      usdValue: v.usdValue.decimalPlaces(8).toNumber(),
    }
  })

  console.log('total ' + totalCommission.toFixed(2) + '$ comm + ' + totalFee.toFixed(2) + '$ fees')

  const day = new Date().toISOString().substring(0, 10)
  await sendToS3(result, day + '.json')
  await sendToS3(result, 'latest.json')

  console.log(JSON.stringify(result))

  return { statusCode: 200 }
}
