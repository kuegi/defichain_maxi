import { Command, Commands } from "./command";
import { Lambda } from "aws-sdk";
import { Telegram } from "../utils/telegram";
import { functionNameWithPostfix } from "../utils/helpers";

export class CheckMaxi extends Command {

    private functionName: string

    constructor(telegram: Telegram) {
        super(telegram)
        this.functionName = functionNameWithPostfix()
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