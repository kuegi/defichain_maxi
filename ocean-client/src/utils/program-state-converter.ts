import { ProgramState } from "../programs/common-program";

export class ProgramStateConverter {
    static toValue(information: ProgramStateInformation): string {
        return "" + information.state + "|" + information.tx + "|" + information.txId + "|" + information.blockHeight
    }

    static fromValue(value: string): ProgramStateInformation {
        let split = value?.split("|")
        if (!split || split.length !== 4) {
            return { state: ProgramState.Idle, tx: "", txId: "", blockHeight: 0 }
        }
        return {
            state: split[0] as ProgramState,
            tx: split[1],
            txId: split[2],
            blockHeight: +split[3],
        }
    }
}

export interface ProgramStateInformation {
    state: ProgramState
    tx: string
    txId: string
    blockHeight: number
}
