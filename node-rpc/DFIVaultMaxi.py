import json
import logging
import sys
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

minCollateralRatio = 180
maxCollateralRatio = 185
lmPair = "SPY-DUSD"
minReinvest = None
logToConsole = True
logToFile = False
logId = ""


settingsPath = sys.argv[1] if len(sys.argv) > 1 else None
# read settings
if settingsPath is not None:
    print("Importing settings from %s" % settingsPath)
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
        if "minReinvest" in settings:
            minReinvest = settings['minReinvest']
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

logger = utils.setup_logger("SafeVault_" + logId, logging.INFO, logToConsole, logToFile)
utils.LOGGER = logger

lastheight = rpc('getblockcount')
vault = rpc("getvault", [vaultId])
assets = lmPair.split("-")
assetA = assets[0]
assetB = assets[1]
targetCollateral = (minCollateralRatio + maxCollateralRatio) / 200
nextPriceBlock = 0

reinvestMsg = " will not reinvest"
if minReinvest is not None:
    reinvestMsg = f" will reinvest when balance goes above {minReinvest} DFI"

if not logToConsole:
    utils.send_telegram(f"starting to monitor {vaultId}")
logger.info(f"starting to monitor. with pair {assetA}-{assetB}. Vault currently at {vault['collateralRatio']}, "
            f"will increase LM above {maxCollateralRatio} and decrease below {minCollateralRatio}," + reinvestMsg)


try:
    frozen = False

    while assetB == "DUSD":
        lastheight = rpc('getblockcount')
        vault = rpc("getvault", [vaultId])

        # TODO: only run loop if new block

        collateralRatio = vault['collateralRatio']
        if nextPriceBlock <= lastheight:
            nextPriceBlock = rpc("getloaninfo")["nextPriceBlock"]
            logger.info(
                f"--next price block: %d currentRatio %d "
                % (nextPriceBlock, collateralRatio,))

        if vault['state'] == 'frozen':
            if not frozen:
                logger.warning(f"{lastheight} vault halted, waiting for resume")
                utils.send_telegram(f"arb: vault halted")
            frozen = True
            sleep(60)
            continue
        if frozen:
            utils.send_telegram(f"arb: vault active again")
            logger.info(f"{lastheight} vault active again")

        frozen = False
        if vault['state'] != "active":
            utils.send_telegram(f"something is wrong with the vault {vaultId}: {str(vault)}")

        if vault['state'] == 'inLiquidation':
            logger.warn(f"got liquidated. quitting")
            break


        if minReinvest is not None:
            dfiBalance = utils.get_balance(address, "DFI")
            if dfiBalance > minReinvest:
                txId = rpc("deposittovault", [vaultId, address, "%.8f@DFI" % dfiBalance, utils.get_tx_input(address)])
                logger.info(f"{lastheight} - reinvesting rewards {dfiBalance}@DFI in {txId}")
                waitForTx(txId)
                logger.info("done")
                vault = rpc("getvault", [vaultId])
                collateralRatio = vault['collateralRatio']

        if 0 < collateralRatio < minCollateralRatio:
            # tODO: also check next ratio ?
            # reduce exposure
            neededrepay = vault['loanValue'] - (vault['collateralValue'] / targetCollateral)
            pool = utils.get_pool(lmPair)
            oracle = rpc("getfixedintervalprice", [assetA + "/USD"])

            neededStock = neededrepay / (oracle['activePrice'] + pool['reserveB/reserveA'])
            account = utils.get_account(address)

            openLoans = []
            for loan in vault["loanAmounts"]:
                t = loan.split("@")
                openLoans.append(t[1])

            if lmPair not in account or assetA not in openLoans or assetB not in openLoans:
                msg = "ERROR: can't withdraw from pool, no tokens left or no loans left"
                logger.error(msg)
                utils.send_telegram(msg)
                sleep(10)  # to not flood
            else:
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

        elif maxCollateralRatio > 0 and (collateralRatio < 0 or collateralRatio > maxCollateralRatio):
            # increase exposure
            pool = utils.get_pool(lmPair)
            oracle = rpc("getfixedintervalprice", [assetA + "/USD"])

            additionalLoan = (vault['collateralValue'] / targetCollateral) - vault['loanValue']
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

            pools = utils.get_pool(lmPair)
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

        sleep(1)

except Exception as e:
    logger.error("uncaught exception: " + str(e) + "\n" + traceback.format_exc())
    utils.send_telegram("LMVault: Exception in script!")
    raise e
