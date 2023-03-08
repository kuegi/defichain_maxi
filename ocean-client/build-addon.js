const util = require('util')
const fs = require('fs');
const zip = require('deterministic-zip');
const crypto = require('crypto');

const exec = util.promisify(require('child_process').exec)

let fileToBuild = process.env.npm_config_file ?? process.env.npm_lifecycle_event
fileToBuild = fileToBuild?.replace('build:', '')

function handleExec(res) {
    if (res.stderr) {
        console.error(res.stderr)
    }

    if (res.error) {
        console.log(res.error.message)
        throw res.error
    }
    console.log(res.stdout)
}

/**
 * Build and ZIP for AWS Lambda Execution
 */
async function buildLambda(file) {
    //delete dist before build to ensure no old files exists 
    fs.rmSync(`./addons/${file}/dist/`, { force: true, recursive: true });
    //delete native build in debian of tiny-secp256k1. Which not exist on Windows (and Mac?)
    //then an elliptic binding is used
    fs.rmSync('./node_modules/tiny-secp256k1/build', { force: true, recursive: true }); {
        //-m minify. Some modules in Windows haf CRLF instead of only LF.
        // no sourcemap files
        const command = `npx --package @vercel/ncc ncc build ./addons/${file}/src/${file}.ts -o ./addons/${file}/dist/${file} -m`
        const res = await exec(command, { cwd: __dirname })
        handleExec(res)
    }

    zip(`./addons/${file}/dist/${file}`, `./addons/${file}/dist/${file}.zip`, { includes: [`*`], cwd: `./addons/${file}/dist/${file}` }, (err) => {
        console.log(`addons/${file}/src/${file}.ts -> addons/${file}/dist/${file}.zip`)
            //calc hash
        const base64 = (crypto.createHash('sha256')).update(fs.readFileSync(`./addons/${file}/dist/${file}.zip`)).digest('base64');
        const hex= (crypto.createHash('sha256')).update(fs.readFileSync(`./addons/${file}/dist/${file}.zip`)).digest('hex')
        console.log(`sha256 hash base64: ${base64}`);
        console.log(`sha256 hash hex: ${hex}`);
    });

}

if (!fileToBuild) {
    console.log("something went wrong!") 
    return
}

buildLambda(fileToBuild).catch(
    e => {
        console.error(e)
    }
)