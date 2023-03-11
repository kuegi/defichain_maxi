import { MainNet } from '@defichain/jellyfish-network'
import { AccountToAccount, AnyAccountToAccount, OP_DEFI_TX, toOPCodes } from '@defichain/jellyfish-transaction/dist'
import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import { SmartBuffer } from 'smart-buffer'
import { fromScript } from '@defichain/jellyfish-address'
import { sendToS3 } from './utils/helpers'
import { AddressHistory } from '@defichain/whale-api-client/dist/api/address'
import BigNumber from 'bignumber.js'

class Ocean {
  public readonly c: WhaleApiClient

  constructor() {
    this.c = new WhaleApiClient({
      url: 'https://ocean.defichain.com',
      version: 'v0',
    })
  }

  public async getAllHistory<T>(address: string, untilBlock: number): Promise<AddressHistory[]> {
    let lastResult = await this.c.address.listAccountHistory(address, 200)
    const pages = [lastResult]
    while (lastResult.hasNext && lastResult[lastResult.length - 1].block.height > untilBlock) {
      try {
        lastResult = await this.c.paginate(pages[pages.length - 1])
        pages.push(lastResult)
      } catch (e) {
        break
      }
    }

    return pages.flatMap((page) => page as AddressHistory[])
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

class TokenData {
  public tokenName = ''
  public txsIn = 0
  public txsOut = 0
  public coinsIn = new BigNumber(0)
  public coinsOut = new BigNumber(0)
  public maxIn = new BigNumber(0)
  public maxOut = new BigNumber(0)
  public oraclePrice: string | undefined

  constructor(token: string) {
    this.tokenName = token
  }

  public toJSON(): Object {
    return {
      tokenName: this.tokenName,
      txsIn: this.txsIn,
      txsOut: this.txsOut,
      coinsIn: this.coinsIn,
      coinsOut: this.coinsOut,
      maxIn: this.maxIn,
      maxOut: this.maxOut,
      oraclePrice: this.oraclePrice,
    }
  }
}

export const HOT_WALLET = 'df1qgq0rjw09hr6vr7sny2m55hkr5qgze5l9hcm0lg'
export const COLD_WALLET = 'df1q9ctssszdr7taa8yt609v5fyyqundkxu0k4se9ry8lsgns8yxgfsqcsscmr'

async function analyzeTxs(o: Ocean, startHeight: number, endHeight: number): Promise<TokenData[]> {
  console.log('starting at block ' + startHeight + ' analysing down until ' + endHeight)

  //read all vaults
  console.log('reading hotwallet history')
  let tokenData = new Map<string, TokenData>()
  const hothistory = await o.getAllHistory(HOT_WALLET, endHeight)

  console.log('analysing ' + hothistory.length + ' entries')
  for (const h of hothistory) {
    if (h.block.height > startHeight || h.block.height < endHeight) {
      continue
    }
    if (h.type !== 'AnyAccountsToAccounts' && h.type !== 'AccountToAccount') {
      continue
    }

    let isColdWalletTransfer = false
    const vouts = await o.c.transactions.getVouts(h.txid)
    const dftxData = toOPCodes(SmartBuffer.fromBuffer(Buffer.from(vouts[0].script.hex, 'hex')))
    if (dftxData[1].type == 'OP_DEFI_TX') {
      const dftx = (dftxData[1] as OP_DEFI_TX).tx
      if (h.type === 'AccountToAccount') {
        const a2a = dftx.data as AccountToAccount
        if (fromScript(a2a.from, MainNet.name)?.address === COLD_WALLET) {
          isColdWalletTransfer = true
        }
        const toCold = a2a.to.find((target) => fromScript(target.script, MainNet.name)?.address === COLD_WALLET)
        if (toCold !== undefined) {
          isColdWalletTransfer = true
        }
      }

      if (h.type == 'AnyAccountsToAccounts') {
        const a2a = dftx.data as AnyAccountToAccount
        const toCold = a2a.to.find((target) => fromScript(target.script, MainNet.name)?.address === COLD_WALLET)
        const fromCold = a2a.from.find((target) => fromScript(target.script, MainNet.name)?.address === COLD_WALLET)
        if (toCold !== undefined || fromCold !== undefined) {
          isColdWalletTransfer = true
        }
      }
    }
    if (!isColdWalletTransfer) {
      h.amounts.forEach((balance) => {
        const parts = balance.split('@')
        const amount = new BigNumber(parts[0])
        const tokenKey = parts[1]
        if (!tokenData.has(tokenKey)) {
          tokenData.set(tokenKey, new TokenData(tokenKey))
        }
        const td = tokenData.get(tokenKey)!
        if (amount.gt(0)) {
          //positive in bridge = inflow into bridge
          td.coinsIn = td.coinsIn.plus(amount)
          td.txsIn += 1
          td.maxIn = BigNumber.max(td.maxIn, amount)
        } else {
          td.coinsOut = td.coinsOut.minus(amount)
          td.txsOut += 1
          td.maxOut = BigNumber.max(td.maxOut, amount.negated())
        }
      })
    }
  }

  const resultList: TokenData[] = []
  tokenData.forEach((v, k) => resultList.push(v))
  return resultList
}

export async function main(event: any, context: any): Promise<Object> {
  const o = new Ocean()

  const startHeight = (await o.c.stats.get()).count.blocks

  const dayListTds = await analyzeTxs(o, startHeight, startHeight - 2880)
  const monthListTds = await analyzeTxs(o, startHeight, startHeight - 2880 * 30)

  const prices = await o.getAll(() => o.c.prices.list())
  const dayList = dayListTds.map((td) => {
    td.oraclePrice = prices.find((p) => p.price.token === td.tokenName)?.price.aggregated.amount
    return td.toJSON()
  })
  const monthList = monthListTds.map((td) => {
    td.oraclePrice = prices.find((p) => p.price.token === td.tokenName)?.price.aggregated.amount
    return td.toJSON()
  })

  console.log('dayData: ' + JSON.stringify(dayList))

  console.log('read tokens in cold and hot wallet')
  const coldTokens = await o.c.address.listToken(COLD_WALLET)
  const hotTokens = await o.c.address.listToken(HOT_WALLET)

  const balanceCold = Object()
  coldTokens.forEach((at) => {
    balanceCold[at.symbol] = at.amount
  })

  const balanceHot = Object()
  hotTokens.forEach((at) => {
    balanceHot[at.symbol] = at.amount
  })

  console.log('sending to S3')
  const date = new Date()
  const forS3 = {
    meta: {
      tstamp: date.toISOString(),
      analysedAt: startHeight,
    },
    txsInBlocks: {
      '2880': dayList,
      '86400': monthList,
    },
    liquidity: {
      hotwallet: balanceHot,
      coldwallet: balanceCold,
    },
  }

  const day = date.toISOString().substring(0, 10)
  await sendToS3(forS3, day + '.json')
  await sendToS3(forS3, 'latest.json')

  return { statusCode: 200 }
}
