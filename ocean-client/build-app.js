const util = require('util')
const fs = require('fs');
const crypto = require('crypto');

const exec = util.promisify(require('child_process').exec)

fileToBuild = 'app'
distfolder = './dist.app'
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
 * Build 
 */
async function buildApp(file) {
  //delete dist before build to ensure no old files exists 
  fs.rmSync(distfolder, {force: true, recursive: true}); 
  //delete native build in debian of tiny-secp256k1. Which not exist on Windows (and Mac?)
  //then an elliptic binding is used
  fs.rmSync('./node_modules/tiny-secp256k1/build', {force: true, recursive: true}); 
  {
    //-m minify. Some modules in Windows haf CRLF instead of only LF.
    // no sourcemap files
    const command = `npx --package @vercel/ncc ncc build ./src/${file}.ts -o ${distfolder} -m`
    const res = await exec(command, { cwd: __dirname })
    handleExec(res)
  }
  
    console.log(`src/${file}.ts -> ${distfolder}/index.js`)
    //calc hash
    const hash = (crypto.createHash('sha256')).update(fs.readFileSync(`${distfolder}/index.js`)).digest('base64');
    console.log(`sha256 hash: ${hash}`);
  
}

buildApp(fileToBuild).catch(
  e => {
    console.error(e)
  }
)