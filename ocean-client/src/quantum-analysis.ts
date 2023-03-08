import { MainNet } from '@defichain/jellyfish-network'
import { AccountToAccount, OP_DEFI_TX, toOPCodes } from '@defichain/jellyfish-transaction/dist'
import { WhaleApiClient } from '@defichain/whale-api-client'
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



public async getAllHistory<T>( address:string, untilBlock:number): Promise<AddressHistory[]> {
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
}

class TokenData {
  public token
  public tokenName= ""
  public txsIn = 0
  public txsOut = 0
  public coinsIn = new BigNumber(0)
  public coinsOut = new BigNumber(0)
  public maxIn = new BigNumber(0)
  public maxOut = new BigNumber(0)
  public liquidity= new BigNumber(0)

  constructor(tokenId:number) {
    this.token= tokenId
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
      liquidity: this.liquidity
    }
  }
}

export const HOT_WALLET = 'df1qgq0rjw09hr6vr7sny2m55hkr5qgze5l9hcm0lg'
export const COLD_WALLET = 'df1q9ctssszdr7taa8yt609v5fyyqundkxu0k4se9ry8lsgns8yxgfsqcsscmr'

export async function main(event: any, context: any): Promise<Object> {
  const o = new Ocean()

  const startHeight = (await o.c.stats.get()).count.blocks
  const analysisWindow = 2880
  const endHeight = startHeight - analysisWindow
  console.log('starting at block ' + startHeight + ' analysing down until ' + endHeight)

  //read all vaults
  console.log('reading hotwallet history')
  let tokenData= new Map<number,TokenData>()
  const hothistory = await o.getAllHistory(HOT_WALLET, endHeight)
  
    for (const h of hothistory) {
      if (
        h.block.height > startHeight || h.block.height < endHeight) {
          continue
        }
      if(h.type ===  'AccountToAccount') {
          const vouts = await o.c.transactions.getVouts(h.txid)

          const dftxData = toOPCodes(SmartBuffer.fromBuffer(Buffer.from(vouts[0].script.hex, 'hex')))
          if (dftxData[1].type == 'OP_DEFI_TX') {
            const dftx = (dftxData[1] as OP_DEFI_TX).tx
            const a2a = dftx.data as AccountToAccount
            const inflow= a2a.to.find(
                (target) =>
                  fromScript(target.script, MainNet.name)?.address === HOT_WALLET,
              )
            inflow?.balances.forEach(balance => {
              if(!tokenData.has(balance.token)) {
                tokenData.set(balance.token,new TokenData(balance.token))
              }
              const td = tokenData.get(balance.token)!
              td.coinsIn = td.coinsIn.plus(balance.amount)
              td.txsIn += 1
              td.maxIn = BigNumber.max(td.maxIn, balance.amount)
            })
            if(fromScript(a2a.from,MainNet.name)?.address === HOT_WALLET) {
              a2a.to.forEach(target => {
                target.balances.forEach(balance => {
              if(!tokenData.has(balance.token)) {
                tokenData.set(balance.token,new TokenData(balance.token))
              }
              const td = tokenData.get(balance.token)!
              td.coinsOut = td.coinsIn.plus(balance.amount)
              td.txsOut += 1
              td.maxOut = BigNumber.max(td.maxOut, balance.amount)
            })
          })
          }
        }
      }
    }
  
  //map tokenId to token
  for(const td of tokenData.values()){
    td.tokenName= (await o.c.tokens.get(""+td.token)).symbol
  }

  const resultList :Object[]= []
  tokenData.forEach((v,k) => resultList.push(v.toJSON()))
  console.log('data: ' + JSON.stringify(resultList))

  console.log("read tokens in cold and hot wallet")
  const coldTokens= await o.c.address.listToken(COLD_WALLET)
  const hotTokens= await o.c.address.listToken(HOT_WALLET)

  const balanceCold= Object()
  coldTokens.forEach(at => {
    balanceCold[at.symbol] = at.amount
  })
  
  const balanceHot= Object()
  hotTokens.forEach(at => {
    balanceHot[at.symbol] = at.amount
  })
  

  console.log('sending to S3')
  const date = new Date()
  const forS3 = {
    meta: {
      tstamp: date.toISOString(),
      startHeight: endHeight,
      endHeight: startHeight,
    },
    tokens: resultList,
    hotwallet: balanceHot,
    coldwallet: balanceCold

  }

  const day = date.toISOString().substring(0, 10)
  await sendToS3(forS3, day + '.json')
  await sendToS3(forS3, 'latest.json')

  return { statusCode: 200 }
}

