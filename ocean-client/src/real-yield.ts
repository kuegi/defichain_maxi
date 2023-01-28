import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'

import {
  AccountToAccount,
  AnyAccountToAccount,
  CAccountToAccount,
  CAnyAccountToAccount,
  CTransaction,
  CTransactionSegWit,
  DeFiTransactionConstants,
  OP_CODES,
  OP_DEFI_TX,
  Script,
  ScriptBalances,
  toOPCodes,
  Transaction,
  TransactionSegWit,
  Vout,
} from '@defichain/jellyfish-transaction/dist'
import BigNumber from 'bignumber.js'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'

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

class YieldForPool {
  public paidCommission = new BigNumber(0)
  public fee = new BigNumber(0)
  public token: string

  constructor(token: string) {
    this.token = token
  }

  public toString(): string {
    return `${this.token}: ${this.paidCommission.toFixed(4)} comm, ${this.fee.toFixed(4)}`
  }
}

export async function main(event: any, context: any): Promise<Object> {
  console.log('real yield calculator')
  const o = new Ocean()
  //read all vaults
  const pools = await o.getAll(() => o.c.poolpairs.list(200))

  const activePools = pools.filter((p) => p.status && +p.totalLiquidity.token > 0)
  console.log('getting swaps for ' + activePools.length + ' pools')
  const yields: Map<string, YieldForPool> = new Map()
  for (const pool of activePools) {
    console.log('processing pool ' + pool.symbol)
    if (!yields.has(pool.tokenA.symbol)) {
      yields.set(pool.tokenA.symbol, new YieldForPool(pool.tokenA.symbol))
    }
    const dataA = yields.get(pool.tokenA.symbol)!
    if (!yields.has(pool.tokenB.symbol)) {
      yields.set(pool.tokenB.symbol, new YieldForPool(pool.tokenB.symbol))
    }
    const dataB = yields.get(pool.tokenB.symbol)!

    const swaps = await o.getAll(() => o.c.poolpairs.listPoolSwapsVerbose(pool.id, 50), 100)
    console.log('got ' + swaps.length + ' swaps to process')
    for (const swap of swaps) {
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
          const fee = new BigNumber(pool.tokenB.fee?.outPct ?? pool.tokenB.fee?.pct ?? 0)
          dataB.fee = dataB.fee.plus(amountB.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
        } else {
          const fee = new BigNumber(pool.tokenB.fee?.inPct ?? pool.tokenB.fee?.pct ?? 0)
          dataB.fee = dataB.fee.plus(amountB.multipliedBy(fee))
          dataB.paidCommission = dataB.paidCommission.plus(amountB.multipliedBy(pool.commission))
        }
      }
      if (amountA === undefined && amountB !== undefined) {
        amountA = amountB.multipliedBy(pool.priceRatio.ab)
        if (AtoB) {
          const fee = new BigNumber(pool.tokenA.fee?.inPct ?? pool.tokenA.fee?.pct ?? 0)
          dataA.fee = dataA.fee.plus(amountA.multipliedBy(fee))
          dataA.paidCommission = dataA.paidCommission.plus(amountA.multipliedBy(pool.commission))
        } else {
          const fee = new BigNumber(pool.tokenA.fee?.outPct ?? pool.tokenA.fee?.pct ?? 0)
          dataA.fee = dataA.fee.plus(amountA.multipliedBy(fee.dividedBy(new BigNumber(1).minus(fee))))
        }
      }
    }
  }
  yields.forEach((v, k) => {
    console.log(v.toString())
  })

  return { statusCode: 200 }
}
