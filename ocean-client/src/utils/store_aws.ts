import { AWSError } from 'aws-sdk'
import SSM, { GetParameterResult, ParameterList } from 'aws-sdk/clients/ssm'
import { PromiseResult } from 'aws-sdk/lib/request'
import { ProgramState } from '../programs/common-program'
import { ProgramStateConverter, ProgramStateInformation } from './program-state-converter'
import { IStore, StoredSettings } from './store'

export class StoredAWSSettings extends StoredSettings {
  paramPostFix: string = ''
  stateInformation: ProgramStateInformation = {
    state: ProgramState.Idle,
    tx: '',
    txId: '',
    blockHeight: 0,
    version: undefined,
  }
}

// abstract Store to handle AWS Paramter
export abstract class StoreAWS {
  protected paramPostFix: string = ''
  private ssm: SSM

  constructor() {
    this.ssm = new SSM()
  }

  postfixedKey(param: string): string {
    return param.replace('-maxi', '-maxi' + this.paramPostFix)
  }
  async updateParameter(key: string, value: string): Promise<void> {
    await this.ssm
      .putParameter({
        Name: key,
        Value: value,
        Overwrite: true,
        Type: 'String',
      })
      .promise()
  }

  async fetchParameters(keys: string[]): Promise<ParameterList> {
    const chunkSize = 10
    let parameters: ParameterList = []
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize)
      parameters.concat(
        (
          await this.ssm
            .getParameters({
              Names: keys.slice(i, i + chunkSize),
            })
            .promise()
        ).Parameters ?? [],
      )
    }

    return parameters
  }

  async readSeed(key: string): Promise<string[]> {
    let decryptedSeed
    try {
      decryptedSeed = await this.ssm
        .getParameter({
          Name: key,
          WithDecryption: true,
        })
        .promise()
    } catch (e) {
      console.error('Seed Parameter not found!')
      decryptedSeed = undefined
    }
    let seedList = decryptedSeed?.Parameter?.Value?.replace(/[ ,]+/g, ' ')
    return seedList?.trim().split(' ') ?? []
  }

  protected getValue(key: string, parameters: SSM.ParameterList): string {
    return parameters?.find((element) => element.Name === key)?.Value as string
  }

  protected getOptionalValue(key: string, parameters: SSM.ParameterList): string | undefined {
    return parameters?.find((element) => element.Name === key)?.Value
  }

  protected getNumberValue(key: string, parameters: SSM.ParameterList): number | undefined {
    let value = parameters?.find((element) => element.Name === key)?.Value
    return value ? +value : undefined
  }

  protected getBooleanValue(key: string, parameters: SSM.ParameterList): boolean | undefined {
    let value = parameters?.find((element) => element.Name === key)?.Value
    return value ? JSON.parse(value) : undefined
  }
}
