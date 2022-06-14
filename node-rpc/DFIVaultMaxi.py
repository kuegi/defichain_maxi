import json
import logging
import sys
import os
from time import sleep

import traceback
import utils
from utils import rpc, waitForTx

'''
Script to keep a Defichain vault within a collateral range and therefore use the LM rewards optimally

DFI donations welcome: dLBqjysPVXYQX4dFSp5hMWdVfbdeY4aHVS
'''

errortimeout = 5  # blocks

vaultId = "vault"
address = "myAdress"

mainCollateralAsset = "DFI"
minCollateralRatio = 160
maxCollateralRatio = -1
targetCollateral = 1.6
lmPair = "GME-DUSD"
assetA = "GME"
assetB = "DUSD"
minReinvest = None
logToConsole = True
logToFile = False
logId = ""

settingsLastModified = 0
logger = None


def readSettings(settingsPath):
    global logger, shouldExecute, settingsLastModified, lastBlockSettingsLogged, \
        vaultId, address, minCollateralRatio, maxCollateralRatio, lmPair, minReinvest, mainCollateralAsset, \
        logToFile, logToConsole, logId, assetA, assetB, targetCollateral, \
        bigFeePerByte, dusdswapamount, minDFIPremium, minDFIFuturePremium, futurePremiumStep, swapLoopsPerBlock, futureAmount, \
        dusdamount, stableentries, stableexits, maxPriceTolerance, \
        usdcPositionsFromSettings, usdtPositionsFromSettings, neededNextPaybackPriceFromSettings, openDUSDNextPositionFromSettings

    lastmodified = os.stat(settingsPath).st_mtime
    if settingsLastModified == lastmodified:
        return
    if logger is not None:
        logger.info(
            f"found changed settings file. last changed: {int(lastmodified)} previous settings from {int(settingsLastModified)}")
    settingsLastModified = lastmodified
    lastBlockSettingsLogged = 0  # report on next block cause they changed
    with open(settingsPath) as f:
        settings = json.load(f)
        if "NODE_URL" in settings:
            utils.NODE_URL = settings["NODE_URL"]
        utils.NODE_USER = settings['NODE_USER']
        utils.NODE_PASSWORD = settings['NODE_PASSWORD']
        vaultId = settings['vaultId']
        address = settings['address']
        if "minCollateralRatio" in settings and "maxCollateralRatio" in settings:
            minCollateralRatio = settings['minCollateralRatio']
            maxCollateralRatio = settings['maxCollateralRatio']
        lmPair = settings['lmPair']
        if "mainCollateralAsset" in settings:
            mainCollateralAsset = settings['mainCollateralAsset']
        if "minReinvest" in settings:
            minReinvest = settings['minReinvest']
        # TODO: add keepWalletClean feature
        if "logToFile" in settings:
            logToFile = settings['logToFile']
        if "logToConsole" in settings:
            logToConsole = settings['logToConsole']
        if "logId" in settings:
            logId = settings['logId']
            utils.logId = logId
        if "telegram" in settings:
            utils.TELEGRAM_TOKEN = settings['telegram']['token']
            utils.TELEGRAM_CHANNEL = settings['telegram']['channel']
            if "logs" in settings['telegram']:
                utils.TELEGRAM_LOG_CHANNEL = settings['telegram']['logs']


    assets = lmPair.split("-")
    assetA = assets[0]
    assetB = assets[1]
    targetCollateral = (minCollateralRatio + maxCollateralRatio) / 200


settingsPath = sys.argv[1] if len(sys.argv) > 1 else None
# read settings
if settingsPath is not None:
    print("Importing settings from %s" % settingsPath)
    readSettings(settingsPath)

logger = utils.setup_logger("SafeVault_" + logId, logging.INFO, logToConsole, logToFile)
utils.LOGGER = logger


lastheight = rpc('getblockcount')
vault = rpc("getvault", [vaultId, True])
nextPriceBlock = 0

lastBlockSettingsLogged = 0


def logSettings(scheduledLog=False):
    global shouldExecute, lastBlockSettingsLogged, \
        vaultId, address, minCollateralRatio, maxCollateralRatio, lmPair, minReinvest, mainCollateralAsset, \
        logToFile, logToConsole, logId, assetA, assetB, targetCollateral, \
        bigFeePerByte, dusdswapamount, minDFIPremium, minDFIFuturePremium, futurePremiumStep, swapLoopsPerBlock, futureAmount, \
        dusdamount, stableentries, stableexits, maxPriceTolerance, \
        usdcPositionsFromSettings, usdtPositionsFromSettings, neededNextPaybackPriceFromSettings, openDUSDNextPositionFromSettings

    vault = rpc("getvault", [vaultId, True])
    lastBlockSettingsLogged = rpc('getblockcount')

    isSingleMint = mainCollateralAsset == "DUSD" or lmPair == "DUSD-DFI"
    singleMintMsg = f" minting only {assetA}" if isSingleMint else "minting both"
    reinvestMsg = " will not reinvest"
    if minReinvest is not None:
        reinvestMsg = f" will reinvest when balance goes above {minReinvest} DFI"
    if scheduledLog:
        msg = "still monitoring "
    else:
        msg = "starting to monitor"
    msg = f"{msg} {vaultId}. with pair {assetA}-{assetB}." \
          f" Vault currently at {vault['collateralRatio']} next {vault['nextCollateralRatio']}, " \
          f"will increase LM above {maxCollateralRatio} and decrease below {minCollateralRatio}," \
          + singleMintMsg + "," + reinvestMsg
    logger.info(msg)

    if not logToConsole and not scheduledLog:
        utils.send_telegram(msg)


def reduceExposureDoubleMint(neededrepay, pool, account):
    oracle = rpc("getfixedintervalprice", [assetA + "/USD"])

    neededStock = neededrepay / (oracle['activePrice'] + pool['reserveB/reserveA'])
    stock_per_token = pool["reserveA"] / pool['totalLiquidity']
    removeTokens = min(neededStock / stock_per_token, account[lmPair])
    wanteddusd = pool['reserveB/reserveA'] * neededStock
    logger.info(f"{rpc('getblockcount')} removing liquidity {round(removeTokens, 4)} tokens for "
                f"{round(neededStock, 3)}@{assetA} , "
                f"{round(wanteddusd, 3)}@{assetB}")
    txId = rpc("removepoolliquidity",
               [address, "%.8f@%s" % (removeTokens, lmPair), utils.get_tx_input(address)])
    waitForTx(txId)
    account = utils.get_account(address)
    neededStock = min(neededStock, account[assetA])
    wanteddusd = min(wanteddusd, account[assetB])
    logger.info(
        f"{rpc('getblockcount')} done, paying back "
        f"{round(neededStock, 3)}@{assetA} , {round(wanteddusd, 3)}@{assetB}")
    data = {"vaultId": vaultId,
            "from": address,
            "amounts": ["%.8f@%s" % (neededStock, assetA),
                        "%.8f@%s" % (wanteddusd, assetB)]
            }
    txId = rpc("paybackloan", [data, utils.get_tx_input(address)])
    waitForTx(txId)
    logger.info(f"{rpc('getblockcount')} done payback")
    utils.send_telegram("done reducing exposure")


def reduceExposureSingleMint(neededrepay, wantedRatio, pool, account):
    if assetA != "DUSD":
        oracleA = rpc("getfixedintervalprice", [assetA + "/USD"])
    else:
        oracleA = {"activePrice": 1}

    if assetB != "DUSD":
        oracleB = rpc("getfixedintervalprice", [assetB + "/USD"])
    else:
        oracleB = {"activePrice": 0.99}  # DUSD only counts 0.99 as collateral

    # read wanted values from dictionary
    oracleA = oracleA["activePrice"]
    oracleB = oracleB["activePrice"]

    neededcollateral = neededrepay * wantedRatio  # I did the calc this way around, so convert it
    reserveA = pool['reserveA']
    reserveB = pool['reserveB']
    totalLiq = pool['totalLiquidity']
    ratioPart = (reserveA * oracleA * wantedRatio + reserveB * oracleB) / totalLiq
    wantedLPTokens = (neededcollateral) / (ratioPart)
    removeTokens = min(wantedLPTokens, account[lmPair])

    expectedA = removeTokens * reserveA / totalLiq
    expectedB = removeTokens * reserveB / totalLiq
    logger.info(f"{rpc('getblockcount')} removing liquidity {round(removeTokens, 4)} tokens for "
                f"{round(expectedA, 3)}@{assetA} , "
                f"{round(expectedB, 3)}@{assetB}")
    txId = rpc("removepoolliquidity",
               [address, "%.8f@%s" % (removeTokens, lmPair), utils.get_tx_input(address)])
    waitForTx(txId)

    account = utils.get_account(address)
    receivedA = min(expectedA, account[assetA])
    receivedB = min(expectedB, account[assetB])
    logger.info(
        f"{rpc('getblockcount')} done, paying back "
        f"{round(receivedA, 3)}@{assetA}")
    data = {"vaultId": vaultId,
            "from": address,
            "amounts": ["%.8f@%s" % (receivedA, assetA)]
            }
    txId = rpc("paybackloan", [data, utils.get_tx_input(address)])
    waitForTx(txId)

    logger.info(
        f"{rpc('getblockcount')} done payback, depositing "
        f"{round(receivedB, 3)}@{assetB}")
    txId = rpc("deposittovault",
               [vaultId, address, "%.8f@%s" % (receivedB, assetB), utils.get_tx_input(address)])
    waitForTx(txId)

    logger.info(f"{rpc('getblockcount')} done deposit and payback")
    utils.send_telegram("done reducing exposure")


def increaseExposureDoubleMint(additionalLoan, pool):
    oracle = rpc("getfixedintervalprice", [assetA + "/USD"])

    neededStock = additionalLoan / (oracle['activePrice'] + pool['reserveB/reserveA'])
    neededDUSD = pool['reserveB/reserveA'] * neededStock
    logger.info(
        f"{rpc('getblockcount')} taking loan {round(neededStock, 3)}@{assetA}, {round(neededDUSD, 3)}@{assetB}")
    data = {"vaultId": vaultId,
            "to": address,
            "amounts": ["%.8f@%s" % (neededDUSD, assetB),
                        "%.8f@%s" % (neededStock, assetA)]
            }
    txId = rpc("takeloan", [data, utils.get_tx_input(address)])
    waitForTx(txId)

    pool = utils.get_pool(lmPair)
    neededStock = pool['reserveA/reserveB'] * neededDUSD

    account = utils.get_account(address)
    if neededStock > account[assetA]:
        neededStock = account[assetA]
        neededDUSD = pool['reserveB/reserveA'] * neededStock
    logger.info(
        f"{rpc('getblockcount')} done, adding liquidity "
        f"{round(neededStock, 3)}@{assetA}, {round(neededDUSD, 3)}@{assetB}")
    data = {address: ["%.8f@%s" % (neededStock, assetA),
                      "%.8f@%s" % (neededDUSD, assetB)]
            }
    txId = rpc("addpoolliquidity", [data, address, utils.get_tx_input(address)])
    waitForTx(txId)
    logger.info(f"{rpc('getblockcount')} done ")
    utils.send_telegram("done increasing exposure")


def increaseExposureSingleMint(additionalLoan, wantedRatio, pool):
    if assetA != "DUSD":
        oracleA = rpc("getfixedintervalprice", [assetA + "/USD"])
    else:
        oracleA = {"activePrice": 1}

    if assetB != "DUSD":
        oracleB = rpc("getfixedintervalprice", [assetB + "/USD"])
    else:
        oracleB = {"activePrice": 0.99}  # DUSD only counts 0.99 as collateral

    # read wanted values from dictionary
    oracleA = oracleA["activePrice"]
    oracleB = oracleB["activePrice"]

    freeCollateral = additionalLoan * wantedRatio  # I did the calc this way around, so convert it

    ratioBA = pool['reserveB/reserveA']
    usedAssetA = freeCollateral / (wantedRatio * oracleA + ratioBA * oracleB)
    usedAssetB = (pool['reserveB/reserveA'] * usedAssetA)

    ####

    logger.info(f"{rpc('getblockcount')} taking loan {round(usedAssetA, 3)}@{assetA}")
    data = {"vaultId": vaultId,
            "to": address,
            "amounts": ["%.8f@%s" % (usedAssetA, assetA)]
            }
    txId = rpc("takeloan", [data, utils.get_tx_input(address)])
    waitForTx(txId)

    logger.info(f"{rpc('getblockcount')} withdrawing {round(usedAssetB, 3)}@{assetB}")
    txId = rpc("withdrawfromvault", [vaultId, address, "%.8f@%s" % (usedAssetB, assetB), utils.get_tx_input(address)])
    waitForTx(txId)

    pool = utils.get_pool(lmPair)
    usedAssetA = pool['reserveA/reserveB'] * usedAssetB

    account = utils.get_account(address)
    if usedAssetA > account[assetA]:
        usedAssetA = account[assetA]
        usedAssetB = pool['reserveB/reserveA'] * usedAssetA
    logger.info(
        f"{rpc('getblockcount')} done, adding liquidity "
        f"{round(usedAssetA, 3)}@{assetA}, {round(usedAssetB, 3)}@{assetB}")
    data = {address: ["%.8f@%s" % (usedAssetA, assetA),
                      "%.8f@%s" % (usedAssetB, assetB)]
            }
    txId = rpc("addpoolliquidity", [data, address, utils.get_tx_input(address)])
    waitForTx(txId)
    logger.info(f"{rpc('getblockcount')} done ")
    utils.send_telegram("done increasing exposure")


try:
    frozen = False
    lastErrorOnBlock = 0


    # initial log of settings
    logSettings()
    while assetB == "DUSD" or lmPair == "DUSD-DFI":
        lastheight = rpc('getblockcount')

        readSettings(settingsPath)
        if lastheight > lastBlockSettingsLogged + 720:
            logSettings(True)  # log periodically to know whats going on

        if mainCollateralAsset != "DFI" and assetB != mainCollateralAsset:
            logger.warning(
                f"can't work with this combination of mainCollateralAsset {mainCollateralAsset} and lmPair {lmPair}")
            mainCollateralAsset = "DFI"
        vault = rpc("getvault", [vaultId, True])
        isSingleMint = mainCollateralAsset == "DUSD" or lmPair == "DUSD-DFI"

        # TODO: only run loop if new block

        collateralRatio = min(vault['collateralRatio'], vault['nextCollateralRatio'])
        if nextPriceBlock <= lastheight:
            nextPriceBlock = rpc("getloaninfo")["nextPriceBlock"]

            utils.send_telegram_log(
                f"current ratio {collateralRatio} ( {vault['collateralRatio']}/{vault['nextCollateralRatio']} ), target range: {minCollateralRatio} - {maxCollateralRatio} running on {lmPair} {('singlemint' if isSingleMint else 'minting both')}")
            logger.info(
                f"--next price block: %d currentRatio %d "
                % (nextPriceBlock, collateralRatio))


        if vault['state'] == 'frozen':
            if not frozen:
                logger.warning(f"{lastheight} vault halted, waiting for resume")
                utils.send_telegram(f"vault halted")
                # TODO: remove exposure for safety
            frozen = True
            sleep(60)
            continue
        if frozen:
            utils.send_telegram(f"vault active again")
            logger.info(f"{lastheight} vault active again")

        frozen = False
        if vault['state'] != "active":
            if lastheight > lastErrorOnBlock:
                utils.send_telegram(f"something is wrong with the vault {vaultId}: {str(vault)}")
            lastErrorOnBlock = lastheight

        if vault['state'] == 'inLiquidation':
            logger.warn(f"got liquidated. quitting")
            break


        if minReinvest is not None:
            dfiBalance = utils.get_balance(address, "DFI")
            if dfiBalance > minReinvest:
                tokensToReinvest = dfiBalance
                if mainCollateralAsset != "DFI":
                    data = {
                        "from": address,
                        "tokenFrom": "DFI",
                        "amountFrom": "%.8f" % dfiBalance,
                        "to": address,
                        "tokenTo": mainCollateralAsset
                    }
                    txId = rpc("compositeswap", [data, utils.get_tx_input(address)])
                    logger.info(
                        f"{lastheight} - swaping rewards {dfiBalance}@DFI to {mainCollateralAsset} in {txId}")
                    waitForTx(txId)
                    tokensToReinvest = utils.get_balance(address, mainCollateralAsset)

                txId = rpc("deposittovault", [vaultId, address, "%.8f@%s" % (tokensToReinvest, mainCollateralAsset),
                                              utils.get_tx_input(address)])
                logger.info(f"{lastheight} - reinvesting rewards {tokensToReinvest}@{mainCollateralAsset} in {txId}")
                waitForTx(txId)
                logger.info("done")
                utils.send_telegram(f"reinvested {tokensToReinvest} {mainCollateralAsset}")
                vault = rpc("getvault", [vaultId, True])
                collateralRatio = min(vault['collateralRatio'], vault['nextCollateralRatio'])

        if 0 < collateralRatio < minCollateralRatio:
            # reduce exposure

            account = utils.get_account(address)

            openLoans = []
            for loan in vault["loanAmounts"]:
                t = loan.split("@")
                openLoans.append(t[1])

            if lmPair not in account or assetA not in openLoans or (not isSingleMint and assetB not in openLoans):
                    msg = "ERROR: can't withdraw from pool, no tokens left or no loans left"
                    logger.error(msg)
                    utils.send_telegram(msg)
                    sleep(10)  # to not flood
            else:
                # not calculating nextLoanValue and nextCollateralValue here, assuming that coll will move more -> approx nextColl via nextRatio and current loan

                neededrepay = max(vault['loanValue'] - (vault['collateralValue'] / targetCollateral),
                                  vault['loanValue'] - (vault['loanValue'] * vault['nextCollateralRatio'] / (
                                              100 * targetCollateral)))
                actualRepay = max(neededrepay, vault['loanValue'] * 0.01)
                logger.info(
                    f"need to reduce exposure. "
                    f"ratios: {vault['collateralRatio']} ({vault['nextCollateralRatio']}) "
                    f"need to repay {neededrepay} will do {actualRepay} USD. current values: {vault['loanValue']} vs {vault['collateralValue']} ")

                pool = utils.get_pool(lmPair)
                if isSingleMint:
                    reduceExposureSingleMint(actualRepay, targetCollateral, pool, account)
                else:
                    reduceExposureDoubleMint(actualRepay, pool, account)

        elif maxCollateralRatio > 0 and (collateralRatio < 0 or collateralRatio > maxCollateralRatio) and vault[
            'collateralValue'] > 10:
            # increase exposure
            pool = utils.get_pool(lmPair)
            # not calculating nextLoanValue and nextCollateralValue here, assuming that coll will move more -> approx nextColl via nextRatio and current loan

            additionalLoan = (vault['collateralValue'] / targetCollateral) - vault['loanValue']
            if vault['nextCollateralRatio'] > 0:
                additionalLoan = min(additionalLoan,
                                     (vault['loanValue'] * vault['nextCollateralRatio'] / (100 * targetCollateral)) -
                                     vault['loanValue'])
            if isSingleMint:
                increaseExposureSingleMint(additionalLoan, targetCollateral, pool)
            else:
                increaseExposureDoubleMint(additionalLoan, pool)


        sleep(1)

except Exception as e:
    logger.error("uncaught exception: " + str(e) + "\n" + traceback.format_exc())
    utils.send_telegram("LMVault: Exception in script!")
    raise e
