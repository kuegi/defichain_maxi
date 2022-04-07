export class PoolStateConverter {
    static toValue(information: PoolStateInformation): string {
        return "" + information.pool + "|" + information.blockHeight + "|" + information.tx + "|" + information.txId
    }

    static fromValue(value: string): PoolStateInformation {
        let split = value?.split("|")
        if(!split || split.length !== 4) {
            return {pool: "", blockHeight: 0, tx: "", txId: "" }
        }
        return {
            pool: split[0],
            blockHeight: +split[1],
            tx: split[2],
            txId: split[3]
        }
    }

}

export interface PoolStateInformation {
    pool: string
    blockHeight: number
    tx: string
    txId: string
}