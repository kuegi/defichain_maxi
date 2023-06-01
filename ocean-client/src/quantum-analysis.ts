import { MainNet } from '@defichain/jellyfish-network'
import { AccountToAccount, AnyAccountToAccount, OP_DEFI_TX, toOPCodes } from '@defichain/jellyfish-transaction/dist'
import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import { SmartBuffer } from 'smart-buffer'
import { fromScript } from '@defichain/jellyfish-address'
import { sendToS3 } from './utils/helpers'
import { AddressHistory } from '@defichain/whale-api-client/dist/api/address'
import BigNumber from 'bignumber.js'
import fetch from 'cross-fetch'
import { PriceTicker } from '@defichain/whale-api-client/dist/api/prices'
import { S3 } from 'aws-sdk'

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

  constructor(token: string) {
    this.tokenName = token
  }

  public toJSON(): Object {
    return {
      tokenName: this.tokenName,
      txsToEthereum: this.txsIn,
      txsToDefichain: this.txsOut,
      coinsToEthereum: this.coinsIn,
      coinsToDefichain: this.coinsOut,
      maxToEthereum: this.maxIn,
      maxToDefichain: this.maxOut,
    }
  }
}

class AnalysisData {
  public meta: {
    tstamp: string
    analysedAt: number
  }
  public prices: { [key: string]: string } = {}
  public txs: TokenData[] = []
  public liquidity: {
    defichain: Object
    ethereum: Object
  }
  public quantumData: {
    liqEth: { [keys: string]: number }
    liqDfc: { [keys: string]: number }
    txsToDfc: Object
    txsToEth: Object
  }

  constructor(tstamp: string, analysedAt: number) {
    this.meta = { tstamp: tstamp, analysedAt: analysedAt }
    this.liquidity = { defichain: {}, ethereum: {} }
    this.quantumData = { liqEth: {}, liqDfc: {}, txsToDfc: {}, txsToEth: {} }
  }

  public addPrices(prices: PriceTicker[]) {
    const wantedPrices: Set<string> = new Set<string>()
    this.txs.forEach((td) => wantedPrices.add(td.tokenName))
    Object.keys(this.liquidity.defichain).forEach((k) => wantedPrices.add(k))
    this.prices = {}
    prices
      .filter((p) => wantedPrices.has(p.price.token))
      .forEach((p) => (this.prices[p.price.token] = p.price.aggregated.amount))
  }

  public toJson(): Object {
    return {
      meta: this.meta,
      prices: this.prices,
      txs: this.txs.map((t) => t.toJSON()),
      liquidity: this.liquidity,
      quantumData: {
        liquidity: {
          ethereum: this.quantumData.liqEth,
          defichain: this.quantumData.liqDfc,
          txsToDfc: this.quantumData.txsToDfc,
          txsToEth: this.quantumData.txsToEth,
        },
      },
    }
  }
}

export const HOT_WALLET = 'df1qgq0rjw09hr6vr7sny2m55hkr5qgze5l9hcm0lg'
export const COLD_WALLETS = ['df1q9ctssszdr7taa8yt609v5fyyqundkxu0k4se9ry8lsgns8yxgfsqcsscmr',"dF3GuAWUE3jy59Ncw9i9Hr54bHRZMPu2bf"]

export const ETH_CONTRACT = '0x54346d39976629b65ba54eac1c9ef0af3be1921b'
export const ETH_COLD = '0x11901fd641f3a2d3a986d6745a2ff1d5fea988eb'
//https://etherscan.io/tokenholdings?a=0x54346d39976629b65ba54eac1c9ef0af3be1921b
//https://etherscan.io/address/0x54346d39976629b65ba54eac1c9ef0af3be1921b

export const ERC_TOKEN_CONTRACTS: Map<string, { address: string; digits: number }> = new Map<
  string,
  { address: string; digits: number }
>([
  ['EUROC', { address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', digits: 6 }],
  ['USDC', { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', digits: 6 }],
  ['USDT', { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', digits: 6 }],
  ['BTC', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', digits: 8 }],
  ['DFI', { address: '0x8fc8f8269ebca376d046ce292dc7eac40c8d358a', digits: 8 }],
])

// quantum api:
// https://api.quantumbridge.app/balances
// https://api.quantumbridge.app/defichain/stats?date=2023-03-15
// https://api.quantumbridge.app/ethereum/stats?date=2023-03-15

function isColdWallet(wallet:string | undefined):boolean {
  return COLD_WALLETS.find(w => w === wallet) != undefined
}

async function analyzeTxs(o: Ocean, firstBlock: number, lastBlock: number): Promise<TokenData[]> {
  console.log('starting at block ' + lastBlock + ' analysing down until ' + firstBlock)

  //read all vaults
  console.log('reading hotwallet history')
  let tokenData = new Map<string, TokenData>()
  const hothistory = await o.getAllHistory(HOT_WALLET, firstBlock)

  console.log('analysing ' + hothistory.length + ' entries')
  for (const h of hothistory) {
    if (h.block.height > lastBlock || h.block.height < firstBlock) {
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
        if (isColdWallet(fromScript(a2a.from, MainNet.name)?.address)) {
          isColdWalletTransfer = true
        }
        const toCold = a2a.to.find((target) => isColdWallet(fromScript(target.script, MainNet.name)?.address))
        if (toCold !== undefined) {
          isColdWalletTransfer = true
        }
      }

      if (h.type == 'AnyAccountsToAccounts') {
        const a2a = dftx.data as AnyAccountToAccount
        const toCold = a2a.to.find((target) => isColdWallet(fromScript(target.script, MainNet.name)?.address))
        const fromCold = a2a.from.find((target) => isColdWallet(fromScript(target.script, MainNet.name)?.address))
        if (toCold !== undefined || fromCold !== undefined) {
          isColdWalletTransfer = true
        } else {          
        console.log("anyAccountTx "+h.txid)
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

async function getETHBalance(): Promise<Object> {
  const apiKey = process.env.ETHERSCAN_KEY

  const result: { [key: string]: string } = {}
  console.log('reading ETH balances')
  for (const token of ERC_TOKEN_CONTRACTS.keys()) {
    const data = ERC_TOKEN_CONTRACTS.get(token)
    const contractAddress = data?.address

    const urlHot =
      `https://api.etherscan.io/api?module=account&action=tokenbalance&tag=latest` +
      `&contractaddress=${contractAddress}` +
      `&address=${ETH_CONTRACT}` +
      `&apikey=${apiKey}`
    console.log('calling ' + urlHot)
    const resultHot = await (await fetch(urlHot)).json()
/*we ignore cold Wallet liquidity cause quantum itself also only reports hotwallet
    const urlCold =
      `https://api.etherscan.io/api?module=account&action=tokenbalance&tag=latest` +
      `&contractaddress=${contractAddress}` +
      `&address=${ETH_COLD}` +
      `&apikey=${apiKey}`
    console.log('calling ' + urlHot)
    const resultCold = await (await fetch(urlCold)).json()
//*/
    result[token] = BigNumber.sum(resultHot['result'], 0/*resultCold['result']*/).div(Math.pow(10, data!.digits)).toString()
  }

  const url =
    `https://api.etherscan.io/api?module=account&action=balancemulti&tag=latest` +
    `&address=${ETH_CONTRACT}` + /* `,${ETH_COLD}` + */
    `&apikey=${apiKey}`
  console.log('calling ' + url)
  const response = (await (await fetch(url)).json())['result']

  result.ETH = BigNumber.sum(response[0].balance, 0/* response[1].balance*/).div(Math.pow(10, 18)).toString()
  return result
}

async function getBlockForTstamp(
  o: Ocean,
  wantedTstamp: number,
  refBlock: { height: number; tstamp: number },
): Promise<number> {
  const dist = (refBlock.tstamp - wantedTstamp) / 30
  console.log(
    'searing for block at tstamp ' +
      wantedTstamp +
      ' refBlock: ' +
      JSON.stringify(refBlock) +
      ' dist ' +
      dist +
      ' targetHeight ' +
      (refBlock.height + dist),
  )
  const blocks = await o.c.blocks.list(200, (refBlock.height - dist + 100).toFixed(0))

  if (blocks[0].time < wantedTstamp) {
    //totally off, recursive from start
    if (blocks[0].height == refBlock.height) {
      console.error('got same block as reference, cancel')
      return blocks[0].height
    }
    return await getBlockForTstamp(o, wantedTstamp, { height: blocks[0].height, tstamp: blocks[0].time })
  }
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock.time > wantedTstamp) {
    //totally off, recursive from start
    if (lastBlock.height == refBlock.height) {
      console.error('got same block as reference, cancel')
      return lastBlock.height
    }
    return await getBlockForTstamp(o, wantedTstamp, { height: lastBlock.height, tstamp: lastBlock.time })
  }
  for (const block of blocks) {
    if (block.time <= wantedTstamp) {
      //first block below target -> choose this one
      return block.height
    }
  }

  return await getBlockForTstamp(o, wantedTstamp, { height: lastBlock.height, tstamp: lastBlock.time }) //will never happen, just for compiler
}

async function analyseDay(o: Ocean, tstampStartOfDay: number): Promise<AnalysisData> {
  // get startBlock and end block
  const stats = await o.c.stats.get()
  const tstampEndOfDay = tstampStartOfDay + 60 * 60 * 24 - 1
  const refBlock = { tstamp: Date.now() / 1000, height: stats.count.blocks }

  const startHeight = await getBlockForTstamp(o, tstampStartOfDay, refBlock)
  const endHeight =
    tstampEndOfDay > refBlock.tstamp ? refBlock.height : await getBlockForTstamp(o, tstampEndOfDay, refBlock)

  //analyse txs from defichain
  const dayListTds = await analyzeTxs(o, startHeight, endHeight)
  //get liq

  const dfcTokens = await o.c.address.listToken(HOT_WALLET)
  const utxosHot = await o.c.address.getBalance(HOT_WALLET)

  //get data from quantum
  const dayString = new Date((1000 * (tstampStartOfDay + tstampEndOfDay)) / 2).toISOString().substring(0, 10)

  console.log('reading quantum data for day ' + dayString)
  const quantBalance = await (await fetch('https://api.quantumbridge.app/balances')).json()
  const quantTxDfc = await (await fetch('https://api.quantumbridge.app/defichain/stats?date=' + dayString)).json()
  const quantTxEth = await (await fetch('https://api.quantumbridge.app/ethereum/stats?date=' + dayString)).json()

  // add prices and aggregate to object
  const balancesDFC = Object()
  dfcTokens.forEach((at) => {
    balancesDFC[at.symbol] = at.amount
  })
  /* we ignore cold Wallet liquidity cause quantum itself also only reports hotwallet
  dfcTokensCold.forEach((at) => {
    if (balancesDFC[at.symbol] != undefined) {
      balancesDFC[at.symbol] = BigNumber.sum(balancesDFC[at.symbol], at.amount)
    } else {
      balancesDFC[at.symbol] = at.amount
    }
  })
  //*/
  balancesDFC.DFI = BigNumber.sum(/*utxosCold,*/ utxosHot, balancesDFC.DFI ?? 0)

  const result = new AnalysisData(new Date(tstampEndOfDay * 1000).toISOString(), endHeight)

  result.quantumData.liqDfc = quantBalance['DFC']
  quantBalance['EVM']['BTC'] = quantBalance['EVM']['WBTC']
  quantBalance['EVM']['WBTC'] = undefined
  result.quantumData.liqEth = quantBalance['EVM']

  //add tx from quantum
  result.quantumData.txsToDfc = quantTxEth
  result.quantumData.txsToEth = quantTxDfc

  //add own data
  result.liquidity.defichain = balancesDFC
  result.liquidity.ethereum = await getETHBalance()
  result.txs = dayListTds

  return result
}

export async function main(event: any, context: any): Promise<Object> {
  const o = new Ocean()
  const prices = await o.getAll(() => o.c.prices.list())

  let yesterdayStart: number
  if (event && event.analyseTstamp) {
    yesterdayStart = +event.analyseTstamp
  } else {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    yesterdayStart = startOfDay.getTime() / 1000 - 60 * 60 * 24
    console.log('analysing latest data')
    const latest = await analyseDay(o, startOfDay.getTime() / 1000)
    latest.addPrices(prices)
    console.log('sending latest data to S3')
    await sendToS3(latest, 'latest.json')
    const day = new Date().toISOString().substring(0, 10)
    await sendToS3(latest, day + '.json')
  }

  const date = new Date((yesterdayStart + 60 * 60 * 12) * 1000)
  const day = date.toISOString().substring(0, 10)
  console.log('analysing data of ' + day)
  const yesterday = await analyseDay(o, yesterdayStart)

  //read liquidity of yesterday and override in yesterday
  const filenameYesterday = day + '.json'

  const s3 = new S3()
  const path = process.env.S3_PATH ?? ''
  const params = {
    Bucket: process.env.S3_BUCKET!,
    Key: path + filenameYesterday,
  }
  const data = await (await s3.getObject(params).promise()).Body?.toString()
  if (data != undefined) {
    const json = JSON.parse(data)
    if (json.liquidity != undefined && json.liquidity.hotwallet != undefined) {
      //old file
      const prices: { [keys: string]: string } = {}
      const liqDfc: { [keys: string]: string } = {}
      const oldLiq = json.liquidity.hotwallet
      for (const token of Object.keys(oldLiq)) {
        prices[token] = oldLiq[token].oraclePrice
        liqDfc[token] = oldLiq[token].amount
      }
      yesterday.liquidity.defichain = liqDfc
      yesterday.prices = prices
    } else {
      yesterday.liquidity = json.liquidity
      yesterday.prices = json.prices
    }
    if (json.quantumData != undefined) {
      yesterday.quantumData.liqDfc = json.quantumData.liqDfc
      yesterday.quantumData.liqEth = json.quantumData.liqEth
    }
  }

  console.log('sending to S3')
  await sendToS3(yesterday, filenameYesterday)

  return { statusCode: 200 }
}
