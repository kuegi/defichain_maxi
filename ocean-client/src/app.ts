import { main } from './vault-maxi'
import os from 'os'


class contexTimer {
    private start = Date.now();
    public getRemainingTimeInMillis() { return 15000 * 60 - (Date.now() - this.start) } //on AWS max. 15 min execution time
}
process.env.VAULTMAXI_LOGID = process.env.VAULTMAXI_LOGID ?? "on " + os.hostname()
const myArgs = process.argv.slice(2);
var event = undefined;
if (!((myArgs.length>0) && (myArgs[0]=='run')))
    event = { overrideSettings: undefined, checkSetup: true }
//@ts-ignore
main(event, new contexTimer)
