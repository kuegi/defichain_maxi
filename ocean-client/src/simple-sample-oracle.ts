import { TestNet } from '@defichain/jellyfish-network'
import { JellyfishWallet } from '@defichain/jellyfish-wallet'
import { MnemonicHdNodeProvider } from '@defichain/jellyfish-wallet-mnemonic'
import { WhaleApiClient } from '@defichain/whale-api-client'
import { WhaleWalletAccount, WhaleWalletAccountProvider } from '@defichain/whale-api-wallet'
import { fromAddress } from '@defichain/jellyfish-address'
import BigNumber from 'bignumber.js'

import fetch from 'node-fetch'
import { CTransactionSegWit, TokenPrice } from '@defichain/jellyfish-transaction'
import { SSM } from 'aws-sdk'
import { WalletClassic } from '@defichain/jellyfish-wallet-classic'
import { WIF } from '@defichain/jellyfish-crypto'

class Settings {
  seed: string[] = []
  address: string = ''
  oracleId: string = ''
  cmcAPIKey: string = ''
}

async function readDataFeed(settings: Settings): Promise<TokenPrice[]> {
  const response = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', {
    headers: {
      'X-CMC_PRO_API_KEY': settings.cmcAPIKey,
    },
  })
  const reply = await response.json()

  const btcData: { quote: any } = reply.data.find((d: any) => d.symbol == 'BTC')
  const usdPrice = btcData.quote['USD']['price']

  return [{ token: 'BTC', prices: [{ amount: BigNumber(usdPrice), currency: 'USD' }] }]
}

async function getSettings(): Promise<Settings> {
  const ssm = new SSM()
  const parameters =
    (
      await ssm
        .getParameters({
          Names: ['/defichain-maxi/oracle/cmcKey', '/defichain-maxi/oracleId', '/defichain-maxi/wallet/address'],
        })
        .promise()
    ).Parameters ?? []
  console.log(parameters)
  const settings: Settings = new Settings()
  settings.address = parameters.find((element) => element.Name === '/defichain-maxi/wallet/address')?.Value as string
  settings.oracleId = parameters.find((element) => element.Name === '/defichain-maxi/oracleId')?.Value as string
  settings.cmcAPIKey = parameters.find((element) => element.Name === '/defichain-maxi/oracle/cmcKey')?.Value as string

  let decryptedSeed
  try {
    decryptedSeed = await ssm
      .getParameter({
        Name: '/defichain-maxi/wallet/seed',
        WithDecryption: true,
      })
      .promise()
  } catch (e) {
    console.error('Seed Parameter not found!')
    decryptedSeed = undefined
  }
  let seedList = decryptedSeed?.Parameter?.Value?.replace(/[ ,]+/g, ' ')
  settings.seed = seedList?.trim().split(' ') ?? []
  return settings
}

export async function main(this: any, event: any, context: any): Promise<Object> {
  //read params from store
  const settings = await getSettings()
  //read data feed
  const tokenPrices: TokenPrice[] = await readDataFeed(settings)

  //init wallet
  const network = TestNet
  const client = new WhaleApiClient({
    url: 'https://testnet-ocean.mydefichain.com:8443',
    version: 'v0',
    network: network.name,
  })

  let wallet
  let account
  if (settings.seed.length == 1) {
    wallet = new WalletClassic(WIF.asEllipticPair(settings.seed[0]))
    account = new WhaleWalletAccount(client, wallet, network)
  } else {
    wallet = new JellyfishWallet(
      MnemonicHdNodeProvider.fromWords(settings.seed, {
        bip32: {
          public: network.bip32.publicPrefix,
          private: network.bip32.privatePrefix,
        },
        wif: network.wifPrefix,
      }),
      new WhaleWalletAccountProvider(client, network),
    )

    let accounts = await wallet.discover()
    account = undefined
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i]
      let address = await acc.getAddress()
      if (address == settings.address) {
        account = acc
        break
      }
    }

    if (!account) {
      console.error('this seed is not good for this address')
      return { statusCode: 500 }
    }
  }

  //send oracle to chain
  console.log('creating Oracle data ' + JSON.stringify(tokenPrices))
  const tx = await account!.withTransactionBuilder().oracles.setOracleData(
    {
      oracleId: settings.oracleId,
      timestamp: BigNumber(Date.now() / 1000),
      tokens: tokenPrices,
    },
    fromAddress(settings.address, network.name)!.script,
  )
  const ctx = new CTransactionSegWit(tx)
  const txId = await client.rawtx.send({ hex: ctx.toHex() })

  console.log('sent tx ' + txId)

  return { statusCode: 200 }
}
