import { ProgramState } from '../programs/common-program'

export class ProgramStateConverter {
  static toValue(information: ProgramStateInformation): string {
    return (
      '' +
      information.state +
      '|' +
      information.tx +
      '|' +
      information.txId +
      '|' +
      information.blockHeight +
      '|' +
      information.version
    )
  }

  static fromValue(value: string): ProgramStateInformation {
    let split = value?.split('|')
    if (!split || split.length < 4) {
      return { state: ProgramState.Idle, tx: '', txId: '', blockHeight: 0, version: undefined }
    }
    return {
      state: split[0] as ProgramState,
      tx: split[1],
      txId: split[2],
      blockHeight: +split[3],
      version: split.length >= 5 ? split[4] : undefined,
    }
  }
}

export interface ProgramStateInformation {
  state: ProgramState
  tx: string
  txId: string
  blockHeight: number
  version: string | undefined
}
