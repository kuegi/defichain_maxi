import { LoanVaultActive, LoanVaultState } from '@defichain/whale-api-client/dist/api/loan'
import { VaultMaxiProgram, VaultMaxiProgramTransaction } from './programs/vault-maxi-program'
import { LogLevel, Telegram } from './utils/telegram'
import { WalletSetup } from './utils/wallet-setup'
import { CommonProgram, ProgramState } from './programs/common-program'
import { ProgramStateConverter } from './utils/program-state-converter'
import { delay, isNullOrEmpty } from './utils/helpers'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { WhaleApiException, WhaleClientTimeoutException } from '@defichain/whale-api-client'
import { StoreConfig } from './utils/store_config'
import { IStoreMaxi, StoreAWSMaxi } from './utils/store_aws_maxi'
import { MainNet, Network, TestNet } from '@defichain/jellyfish-network'

import fetch from 'node-fetch'

class SettingsOverride {
  minCollateralRatio: number | undefined
  maxCollateralRatio: number | undefined
  LMToken: string | undefined
  LMPair: string | undefined
  mainCollateralAsset: string | undefined
  ignoreSkip: boolean = false
}

class maxiEvent {
  overrideSettings: SettingsOverride | undefined
  checkSetup: boolean | undefined
}

const MIN_TIME_PER_ACTION_MS = 300 * 1000 //min 5 minutes for action. probably only needs 1-2, but safety first?

export const VERSION = 'v2.5.3'

export async function main(event: maxiEvent, context: any): Promise<Object> {
  console.log('vault maxi ' + VERSION)
  let blockHeight = 0
  let cleanUpTries = 0
  // adding multiples so that we alternate the first retries
  let mainOceansToUse = ['https://ocean.defichain.com']
  let testOceansToUse = ['https://testnet.ocean.jellyfishsdk.com']
  if (process.env.VAULTMAXI_OCEAN_URL) {
    mainOceansToUse.push(process.env.VAULTMAXI_OCEAN_URL.trim())
    testOceansToUse.push(process.env.VAULTMAXI_OCEAN_URL.trim())
  }
  let firstRun = true
  let errorCooldown = 60000
  let heartBeatSent = false
  let oceansToUse: string[] = []
  while (context.getRemainingTimeInMillis() >= MIN_TIME_PER_ACTION_MS) {
    console.log('starting with ' + context.getRemainingTimeInMillis() + 'ms available')

    let store: IStoreMaxi
    var aws_execution_env = process.env.AWS_EXECUTION_ENV
    if (process.env.LOG_ENV == 'TRUE') console.log(process.env)
    if (aws_execution_env) {
      store = new StoreAWSMaxi()
    } else {
      store = new StoreConfig()
    }
    const settings = await store.fetchSettings()
    console.log('initial state: ' + ProgramStateConverter.toValue(settings.stateInformation))

    if (firstRun) {
      oceansToUse =
        WalletSetup.guessNetworkFromAddress(settings.address) === MainNet ? mainOceansToUse : testOceansToUse

      if (settings.oceanUrl && settings.oceanUrl.length > 0) {
        oceansToUse = oceansToUse.concat(
          settings.oceanUrl
            .replace(/[, ]+/g, ',')
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url.length > 0),
        )
      }
    }
    console.log('using oceans ' + JSON.stringify(oceansToUse))

    const usedLogId = settings.logId
    const logId = usedLogId && usedLogId.length > 0 ? ' ' + usedLogId : ''
    const telegram = new Telegram(settings, '[Maxi' + store.paramPostFix + ' ' + VERSION + logId + ']')

    let commonProgram: CommonProgram | undefined
    try {
      if (settings.shouldSkipNext) {
        //reset to false, so no double skip ever
        console.log('got skip command, reset to false')
        await store.clearSkip()
      }
      if (event) {
        console.log('received event ' + JSON.stringify(event))
        if (event.overrideSettings) {
          if (event.overrideSettings.maxCollateralRatio)
            settings.maxCollateralRatio = event.overrideSettings.maxCollateralRatio
          if (event.overrideSettings.minCollateralRatio)
            settings.minCollateralRatio = event.overrideSettings.minCollateralRatio
          if (event.overrideSettings.LMToken) settings.LMPair = event.overrideSettings.LMToken + '-DUSD'
          if (event.overrideSettings.LMPair) settings.LMPair = event.overrideSettings.LMPair
          if (event.overrideSettings.mainCollateralAsset)
            settings.mainCollateralAsset = event.overrideSettings.mainCollateralAsset
          if (event.overrideSettings.ignoreSkip && settings.shouldSkipNext) {
            settings.shouldSkipNext = false
            await store.skipNext()
          }
        }
      }
      if (settings.shouldSkipNext) {
        //inform EVERYONE to not miss it in case of an error.
        const message = 'skipped one execution as requested'
        console.log(message)
        await telegram.send(message, LogLevel.ERROR)
        return { statusCode: 200 }
      }

      const program = new VaultMaxiProgram(store, settings, new WalletSetup(settings, oceansToUse.pop()))
      commonProgram = program
      await program.init()
      blockHeight = await program.getBlockHeight()

      const blockLog = await program.client.blocks.list(5)
      console.log('starting at block ' + blockHeight + ' last blocks: ' + JSON.stringify(blockLog))

      const vaultcheck = await program.getVault()
      let pool = await program.getPool(program.lmPair)
      let balances = await program.getTokenBalances()
      if (!(await program.doMaxiChecks(telegram, vaultcheck, pool, balances))) {
        return { statusCode: 500 }
      }
      //do checkSetup after general checks, so that a successfully checkSetup without errors means its really all good.
      if (event) {
        if (event.checkSetup) {
          let result = await program.doAndReportCheck(telegram, oceansToUse.slice(3))
          return { statusCode: result ? 200 : 500 }
        }
      }

      //real execution starts here, so doing heartbeat here, but only once per trigger
      if (!heartBeatSent && settings.heartBeatUrl !== undefined) {
        heartBeatSent = true
        try {
          console.log('sending heartbeat to ' + settings.heartBeatUrl)
          await fetch(settings.heartBeatUrl)
        } catch (e) {
          console.error('error sending heartbeat: ' + e)
          await telegram.send('Error sending heartbeat. please check logs and adapt settings', LogLevel.ERROR)
        }
      }

      let result = true
      let vault: LoanVaultActive = vaultcheck as LoanVaultActive //already checked before if all is fine

      //TODO: move that block to function in programm
      // 2022-03-08 Krysh: Something went wrong on last execution, we need to clean up, whatever was done
      if (settings.stateInformation.state !== ProgramState.Idle) {
        const information = settings.stateInformation
        console.log('last execution stopped state ' + information.state)
        console.log(' at tx ' + information.tx)
        console.log(' with txId ' + information.txId)
        console.log(' on block height ' + information.blockHeight)

        // 2022-03-09 Krysh: input of kuegi
        // if we are on state waiting for last transaction,  we should wait for txId
        if (information.state === ProgramState.WaitingForTransaction || information.txId.length > 0) {
          console.log('waiting for tx from previous run')
          const resultFromPrevTx = await program.waitForTx(information.txId, information.blockHeight)
          vault = (await program.getVault()) as LoanVaultActive
          balances = await program.getTokenBalances()
          pool = await program.getPool(program.lmPair)
          console.log(resultFromPrevTx ? 'done' : ' timed out -> cleanup')
          if (
            !resultFromPrevTx ||
            VaultMaxiProgram.shouldCleanUpBasedOn(information.tx as VaultMaxiProgramTransaction)
          ) {
            information.state = ProgramState.Error //force cleanup
          } else if (information.state === ProgramState.WaitingForTransaction) {
            information.state = ProgramState.Idle
          }
          await program.updateToState(information.state, VaultMaxiProgramTransaction.None)
        }
        // 2022-03-09 Krysh: only clean up if it is really needed, otherwise we are fine and can proceed like normally
        if (information.state === ProgramState.Error && cleanUpTries < 3) {
          //only cleanup if not tried too often already
          //if we already tried 3 cleanups without success -> try a normal round to maybe reduce additional exposure and go back to cleanup in next execution
          console.log('need to clean up failed ' + cleanUpTries + ' times so far')
          cleanUpTries += 1 //will be set to 0 if success
          result = await program.cleanUp(vault, balances, telegram, cleanUpTries - 1)
          vault = (await program.getVault()) as LoanVaultActive
          balances = await program.getTokenBalances()
          pool = await program.getPool(program.lmPair)
          //need to get updated vault
          await telegram.send(
            'executed clean-up part of script ' +
              (result ? 'successfully' : 'with problems') +
              '. vault ratio after clean-up ' +
              vault.collateralRatio,
            LogLevel.VERBOSE,
          )
          if (!result) {
            //probably a timeout
            console.error('Error in cleaning up, trying again in safetyMode')
            await telegram.send(
              'There was an error in recovering from a failed state. please check yourself!',
              LogLevel.ERROR,
            )
            if (context.getRemainingTimeInMillis() > MIN_TIME_PER_ACTION_MS) {
              result = await program.cleanUp(vault, balances, telegram, cleanUpTries)
              vault = (await program.getVault()) as LoanVaultActive
              balances = await program.getTokenBalances()
              pool = await program.getPool(program.lmPair)
            }
          } else {
            console.log('cleanup done')
            await telegram.send('Successfully cleaned up after some error happened', LogLevel.WARNING)
          }
          //if it worked after multiple times: set to error to clean the whole adress in case of temporary error.
          await program.updateToState(
            cleanUpTries > 2 ? ProgramState.Error : ProgramState.Idle,
            VaultMaxiProgramTransaction.None,
          )
          cleanUpTries = 0
          console.log('got ' + (context.getRemainingTimeInMillis() / 1000).toFixed(1) + ' sec left after cleanup')
          if (context.getRemainingTimeInMillis() < MIN_TIME_PER_ACTION_MS) {
            return { statusCode: result ? 200 : 500 } //not enough time left, better quit and have a clean run on next invocation
          }
        }
      }

      program.logVaultData(vault)

      if (vault.state == LoanVaultState.FROZEN) {
        console.log('vault is frozen, removing exposure')
        await program.removeExposure(vault, pool!, balances, telegram, true)
        const message = 'vault is frozen. trying again later '
        await telegram.send(message, LogLevel.INFO)

        //to prevent problems on chainsplit or any trouble with the chain on this ocean: check blockdata
        const refBlocks = 100
        const lastBlocks = await program.client.blocks.list(refBlocks)
        const lastTime = lastBlocks[0].time
        const prevTime = lastBlocks[refBlocks - 1].time
        const blockTimeThreshold = program.isTestnet() ? 75 : 45
        if (
          oceansToUse.length > 0 &&
          (lastTime < Date.now() / 1000 - 15 * 60 || lastTime - prevTime > refBlocks * blockTimeThreshold)
        ) {
          //more than 15 minutes no block or too long blocktime
          //  means this chain is not stable/not the main chain-> redo with other ocean
          await telegram.send(
            `chain feels unstable on ocean ${commonProgram.getUsedOceanUrl()}, doing an extra round with next fallback ocean.` +
              `${Date.now() / 1000} vs ${lastTime} (diff ${((Date.now() / 1000 - lastTime) / 60).toFixed(
                1,
              )} min), avg blocktime ${(lastTime - prevTime) / refBlocks}`,
            LogLevel.INFO,
          )
          continue
        }
        return { statusCode: 200 }
      }

      //if DUSD loan is involved and current interest rate on DUSD is above LM rewards -> remove Exposure
      if (settings.mainCollateralAsset === 'DFI') {
        const poolApr = (pool?.apr?.total ?? 0) * 100
        const dusdToken = await program.getLoanToken('' + program.dusdTokenId)
        let interest = +vault.loanScheme.interestRate + +dusdToken.interest
        console.log(
          'DUSD currently has a total interest of ' +
            interest.toFixed(4) +
            ' = ' +
            vault.loanScheme.interestRate +
            ' + ' +
            dusdToken.interest +
            ' vs APR of ' +
            poolApr.toFixed(4),
        )
        if (interest > poolApr) {
          await telegram.send('interest rate higher than APR -> removing/preventing exposure', LogLevel.INFO)
          settings.maxCollateralRatio = -1
        }
      }

      const oldRatio = +vault.collateralRatio
      const nextRatio = program.nextCollateralRatio(vault)
      const usedCollateralRatio = BigNumber.min(vault.collateralRatio, nextRatio)
      console.log(
        'starting with ' +
          vault.collateralRatio +
          ' (next: ' +
          nextRatio +
          ') in vault, target ' +
          settings.minCollateralRatio +
          ' - ' +
          settings.maxCollateralRatio +
          ' (' +
          program.targetRatio() * 100 +
          ') pair ' +
          settings.LMPair +
          ', ' +
          (program.isSingle() ? 'minting only ' + program.assetA : 'minting both'),
      )
      let exposureChanged = false

      if (!program.consistencyChecks(vault)) {
        //maybe just temporary, try again
        await delay(15000)
        console.warn('consistency checks failed. maybe just a temporary caching topic. will try again')
        vault = (await program.getVault()) as LoanVaultActive
        balances = await program.getTokenBalances()
        pool = await program.getPool(program.lmPair)
        if (!program.consistencyChecks(vault)) {
          console.warn('consistency checks failed. will remove exposure')
          await telegram.send(
            'Consistency checks in ocean (' +
              program.getUsedOceanUrl() +
              ') data failed. Something is wrong, so will remove exposure to be safe.',
            LogLevel.WARNING,
          )
          settings.maxCollateralRatio = -1
        }
      }

      //first check for removeExposure, then decreaseExposure
      // if no decrease necessary: check for reinvest (as a reinvest would probably trigger an increase exposure, do reinvest first)
      // no reinvest (or reinvest done and still time left) -> check for increase exposure
      if (settings.maxCollateralRatio <= 0) {
        if (usedCollateralRatio.gt(0)) {
          result = await program.removeExposure(vault, pool!, balances, telegram)
          exposureChanged = true
          vault = (await program.getVault()) as LoanVaultActive
          balances = await program.getTokenBalances()
        }
      } else if (usedCollateralRatio.gt(0) && usedCollateralRatio.lt(settings.minCollateralRatio)) {
        result = await program.decreaseExposure(vault, pool!, telegram)
        exposureChanged = true
        vault = (await program.getVault()) as LoanVaultActive
        balances = await program.getTokenBalances()
      } else {
        result = true
        exposureChanged = await program.checkAndDoReinvest(vault, pool!, balances, telegram)
        console.log('got ' + (context.getRemainingTimeInMillis() / 1000).toFixed(1) + ' sec left after reinvest')
        if (exposureChanged) {
          vault = (await program.getVault()) as LoanVaultActive
          balances = await program.getTokenBalances()
        }
        if (context.getRemainingTimeInMillis() > MIN_TIME_PER_ACTION_MS) {
          // enough time left -> continue
          const usedCollateralRatio = BigNumber.min(+vault.collateralRatio, program.nextCollateralRatio(vault))
          if (+vault.collateralValue < 10) {
            const message = "less than 10 dollar in the vault. can't work like that"
            await telegram.send(message, LogLevel.ERROR)
          } else if (usedCollateralRatio.lt(0) || usedCollateralRatio.gt(settings.maxCollateralRatio)) {
            ;[result, exposureChanged] = await program.increaseExposure(vault, pool!, balances, telegram)
            vault = (await program.getVault()) as LoanVaultActive
            balances = await program.getTokenBalances()
          }
        }
        if (context.getRemainingTimeInMillis() > MIN_TIME_PER_ACTION_MS && settings.stableCoinArbBatchSize > 0) {
          // enough time left -> continue
          const freeCollateral = BigNumber.min(
            +vault.collateralValue - +vault.loanValue * (+vault.loanScheme.minColRatio / 100 + 0.01),
            program
              .nextCollateralValue(vault)
              .minus(program.nextLoanValue(vault).times(+vault.loanScheme.minColRatio / 100 + 0.01)),
          )
          let batchSize = settings.stableCoinArbBatchSize
          if (freeCollateral.lt(settings.stableCoinArbBatchSize)) {
            const message =
              'available collateral from ratio (' +
              freeCollateral.toFixed(1) +
              ') is less than batchsize for Arb, please adjust'
            await telegram.send(message, LogLevel.WARNING)
            batchSize = freeCollateral.toNumber()
          }
          if (batchSize > 0) {
            const changed = await program.checkAndDoStableArb(vault, pool!, batchSize, telegram)
            exposureChanged = exposureChanged || changed
            if (changed) {
              vault = (await program.getVault()) as LoanVaultActive
              balances = await program.getTokenBalances()
            }
          }
        }
      }
      if (vault.state === LoanVaultState.MAY_LIQUIDATE) {
        program.logVaultData(vault)
        await telegram.send(
          'The chain thinks your vault might get liquidated, but data gave us no reason to change something. There is something wrong so we remove exposure for safety sake.',
          LogLevel.WARNING,
        )
        result = await program.removeExposure(vault, pool!, balances, telegram)
        if (!result) {
          vault = (await program.getVault()) as LoanVaultActive
          balances = await program.getTokenBalances()
          await program.cleanUp(vault, balances, telegram)
        }
      }

      await program.updateToState(
        result && cleanUpTries == 0 ? ProgramState.Idle : ProgramState.Error,
        VaultMaxiProgramTransaction.None,
      )
      console.log('wrote state')
      const safetyLevel = await program.calcSafetyLevel(vault, pool!, balances)
      let message = 'executed script at block ' + blockHeight + ' '
      if (exposureChanged) {
        message +=
          (result ? 'successfully' : 'with problems') +
          '.\nvault ratio changed from ' +
          oldRatio +
          ' (next ' +
          nextRatio +
          ') to ' +
          vault.collateralRatio +
          ' (next ' +
          program.nextCollateralRatio(vault) +
          ').'
      } else {
        message += 'without changes.\nvault ratio ' + oldRatio + ' next ' + nextRatio + '.'
      }
      message += '\ntarget range ' + settings.minCollateralRatio + ' - ' + settings.maxCollateralRatio + '\n'
      if (safetyLevel.gt(10000)) {
        message += 'Maxi could bring your vault above 10000% collRatio. All safe.'
      } else {
        message += 'Maxi could bring your vault to a collRatio of ' + safetyLevel.toFixed(0) + '%'
      }
      message += '\n used ocean at: ' + commonProgram.getUsedOceanUrl()
      await telegram.send(message, LogLevel.VERBOSE)
      console.log('script done, safety level: ' + safetyLevel.toFixed(0))
      //to prevent problems on chainsplit or any trouble with the chain on this ocean: check blockdata
      const refBlocks = 100
      const lastBlocks = await program.client.blocks.list(refBlocks)
      const lastTime = lastBlocks[0].time
      const prevTime = lastBlocks[refBlocks - 1].time
      const blockTimeThreshold = program.isTestnet() ? 75 : 45
      if (
        oceansToUse.length > 0 &&
        (lastTime < Date.now() / 1000 - 15 * 60 || lastTime - prevTime > refBlocks * blockTimeThreshold)
      ) {
        //more than 15 minutes no block or too long blocktime
        //  means this chain is not stable/not the main chain-> redo with other ocean
        await telegram.send(
          `chain feels unstable on ocean ${commonProgram.getUsedOceanUrl()}, doing an extra round with next fallback ocean.` +
            `${Date.now() / 1000} vs ${lastTime} (diff ${((Date.now() / 1000 - lastTime) / 60).toFixed(
              1,
            )} min), avg blocktime ${(lastTime - prevTime) / refBlocks}`,
          LogLevel.INFO,
        )
        continue
      }
      return { statusCode: result ? 200 : 500 }
    } catch (e) {
      console.error('Error in script')
      console.error(e)
      let errorMessage = ''
      if (e instanceof WhaleApiException) {
        errorMessage = '\nMessage was: ' + e.message
      }
      let message = 'There was an unexpected error in the script. please check the logs.' + errorMessage
      if (e instanceof SyntaxError) {
        console.info("syntaxError: '" + e.name + "' message: " + e.message)
        if (e.message == 'Unexpected token < in JSON at position 0') {
          message = 'There was a error from the ocean api. will try again.'
        }
        //TODO: do we have to go to error state in this case? or just continue on current state next time?
      }
      if (e instanceof WhaleClientTimeoutException) {
        message = 'There was a timeout from the ocean api. will try again.'
        //TODO: do we have to go to error state in this case? or just continue on current state next time?
      }
      message += '\nused ocean at ' + commonProgram?.getUsedOceanUrl()
      await telegram.send(message, LogLevel.ERROR)

      //program might not be there, so directly the store with no access to ocean
      await store.updateToState({
        state: ProgramState.Error,
        tx: '',
        txId: commonProgram?.pendingTx ?? '',
        blockHeight: blockHeight,
        version: VERSION,
      })
      await delay(errorCooldown) // cooldown and not to spam telegram
      errorCooldown += 60000 //increase cooldown. if error is serious -> less spam in telegram
    } finally {
      firstRun = false
    }
  }
  return { statusCode: 500 } //means we came out of error loop due to not enough time left
}
