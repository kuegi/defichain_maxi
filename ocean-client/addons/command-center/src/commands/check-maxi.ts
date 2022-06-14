import { Command, Commands } from "./command";
import { Lambda } from "aws-sdk";
import { Telegram } from "../utils/telegram";

export class CheckMaxi extends Command {

    private functionName: string

    constructor(telegram: Telegram) {
        super(telegram)
        let postfix = process.env.VAULTMAXI_STORE_POSTFIX ?? process.env.VAULTMAXI_STORE_POSTIX ?? ""
        this.functionName = "defichain-vault-maxi" + postfix
    }

    name(): string {
        return Commands.CheckMaxi
    }

    description(): string {
        return "executes check-setup on your vault-maxi (Lambda function name: " + this.functionName + ")"
    }

    doExecution(): Promise<unknown> {
        let lambda = new Lambda()
        
        let params = {
            FunctionName: this.functionName,
            InvocationType: "Event",
            LogType: "None",
            Payload: '{"checkSetup":true}'
        }

        return lambda.invoke(params).promise()
    }
}