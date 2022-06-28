import { Lambda } from "aws-sdk";
import { functionNameWithPostfix } from "../utils/helpers";
import { Telegram } from "../utils/telegram";
import { Command, Commands } from "./command";

export class Execute extends Command {

    private functionName: string
    private payload: string
    private successMessage: string

    static description = "executes your vault-maxi (Lambda function name: " + functionNameWithPostfix() + ")"

    constructor(telegram: Telegram, payload: string = "", successMessage: string = "execution done") {
        super(telegram)
        this.functionName = functionNameWithPostfix()
        this.payload = payload
        this.successMessage = successMessage
    }

    doExecution(): Promise<unknown> {
        let lambda = new Lambda()
        
        let params = {
            FunctionName: this.functionName,
            InvocationType: "RequestResponse",
            LogType: "None",
            Payload: this.payload
        }
        console.log("invoking lambda with params "+JSON.stringify(params))
        return lambda.invoke(params).promise().then((value) => {
            // read payload to get status code of executed lambda
            if (value.Payload !== undefined) {
                let lambdaResponse = JSON.parse(value.Payload as string)
                if (lambdaResponse.statusCode === 200) {
                    this.telegram.send(this.successMessage)
                } else {
                    this.telegram.send("Triggered execution returned with an error. Please check yourself!")
                }
            } else {
                this.telegram.send("Triggered execution returned with an error. Please check yourself!")
            }
        })
    }

}