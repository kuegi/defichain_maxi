import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client'
import { AddressHistory } from '@defichain/whale-api-client/dist/api/address'
import { S3 } from 'aws-sdk'

export class Ocean {
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


  public async getBlockForTstamp(
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
    const blocks = await this.c.blocks.list(200, (refBlock.height - dist + 100).toFixed(0))

    if (blocks[0].time < wantedTstamp) {
      //totally off, recursive from start
      if (blocks[0].height == refBlock.height) {
        console.error('got same block as reference, cancel')
        return blocks[0].height
      }
      return await this.getBlockForTstamp(wantedTstamp, { height: blocks[0].height, tstamp: blocks[0].time })
    }
    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock.time > wantedTstamp) {
      //totally off, recursive from start
      if (lastBlock.height == refBlock.height) {
        console.error('got same block as reference, cancel')
        return lastBlock.height
      }
      return await this.getBlockForTstamp(wantedTstamp, { height: lastBlock.height, tstamp: lastBlock.time })
    }
    for (const block of blocks) {
      if (block.time <= wantedTstamp) {
        //first block below target -> choose this one
        return block.height
      }
    }

    return await this.getBlockForTstamp(wantedTstamp, { height: lastBlock.height, tstamp: lastBlock.time }) //will never happen, just for compiler
  }
}

export function isNullOrEmpty(value: string): boolean {
  return value === undefined || value.length === 0
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function simplifyAddress(address: string) {
  if (address.length > 15) {
    return address.substring(0, 8) + '...' + address.substring(address.length - 4)
  } else {
    return address
  }
}

export async function sendToS3(data: Object, filename: string): Promise<void> {
  await sendToS3Full(data, process.env.S3_PATH ?? '',filename)
}

export async function sendToS3Full(data: Object, path: string, filename: string): Promise<void> {
  const s3 = new S3()
  const params = {
    Bucket: process.env.S3_BUCKET!,
    Key: path + filename,
    ACL: 'public-read',
    Body: JSON.stringify(data),
  }
  await s3
    .putObject(params, (err, data) => {
      if (err) {
        console.error('error writing object: ' + err)
      }
    })
    .promise()
}
