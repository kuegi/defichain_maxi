import { S3 } from 'aws-sdk'

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
      } else {
        console.log('wrote object')
      }
    })
    .promise()
}
