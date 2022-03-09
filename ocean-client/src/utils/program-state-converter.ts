import { ProgramState } from "../programs/common-program";

export class ProgramStateConverter {
    static toValue(information: ProgramStateInformation): string {
        return "" + information.state + "|" + information.tx + "|" + information.blockHeight
    }

    static fromValue(value: string): ProgramStateInformation|undefined {
        let split = value.split("|")
        if (split.length !== 3) {
            return undefined
        }
        return {
            state: split[0] as ProgramState,
            tx: split[1],
            blockHeight: +split[2],
        }
    }
}

export interface ProgramStateInformation {
    state: ProgramState
    tx: string
    blockHeight: number
}