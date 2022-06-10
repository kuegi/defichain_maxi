import { Command, Commands } from "./command";
import { Lambda } from "aws-sdk";

export class CheckMaxi extends Command {
    name(): string {
        return Commands.CheckMaxi
    }

    description(): string {
        return "executes check-setup on your vault maxi"
    }

    doExecution(): Promise<unknown> {
        let lambda = new Lambda()

        let params = {
            FunctionName: "defichain-vault-maxi",
            InvocationType: "Event",
            LogType: "None",
            Payload: '{"checkSetup":true}'
        }

        return lambda.invoke(params).promise()
    }
}