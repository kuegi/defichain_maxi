const util = require('util')
const fs = require('fs');
const zip = require('deterministic-zip');
const crypto = require('crypto');

const exec = util.promisify(require('child_process').exec)

fileToBuild = process.env.npm_config_file
console.log("building " + fileToBuild)

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
  fs.rmSync('./dist', {force: true, recursive: true}); //delete dist before build to ensure no old files exists 

  {
    const command = `npx --package @vercel/ncc ncc build ./src/${file}.ts --source-map -o ./dist/${file}`
    const res = await exec(command, { cwd: __dirname })
    handleExec(res)
  }
  
  zip(`./dist/${file}`, `./dist/${file}.zip`, {includes: [`*`], cwd: `./dist/${file}`}, (err) => {
    console.log(`src/${file}.ts -> dist/${file}.zip`)
    //calc hash
    const hash = (crypto.createHash('sha256')).update(fs.readFileSync(`./dist/${file}.zip`)).digest('base64');
    console.log(`sha256 hash: ${hash}`);
  });

}

buildLambda(fileToBuild).catch(
  e => {
    console.error(e)
  }
)