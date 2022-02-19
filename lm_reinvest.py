from audioop import add
import json
import logging
import sys
from time import sleep

import utils
from utils import rpc, waitForTx

'''
Script to keep reinvesting in DFI-DUSD pool every time minReinvest is reached on your address.
Based on kuegi's DefiVaultMaxi.py script

kuegi DFI donations: dLBqjysPVXYQX4dFSp5hMWdVfbdeY4aHVS
krysh DFI donations: dZ69fTXJ15YyDKCjAxTKqJ9qx2iV5Yq7cS
'''

errortimeout = 5  # blocks

address = "myAddress"
min_reinvest = 3 # measured in DFI

lm_pair = "DUSD-DFI"
log_to_console = True
log_to_file = False
log_id = ""

settings_path = sys.argv[1] if len(sys.argv) > 1 else None
# read settings
if settings_path is not None:
    print("Importing settings from %s" % settings_path)
    with open(settings_path) as f:
        settings = json.load(f)
        utils.NODE_USER = settings['NODE_USER']
        utils.NODE_PASSWORD = settings['NODE_PASSWORD']
        address = settings['address']
        min_reinvest = settings['minReinvest']

        if "logToFile" in settings:
            log_to_file = settings['logToFile']
        if "logToConsole" in settings:
            log_to_console = settings['logToConsole']
        if "logId" in settings:
            log_id = settings['logId']
            utils.logId = log_id
        if "telegram" in settings:
            utils.TELEGRAM_TOKEN = settings['telegram']['token']
            utils.TELEGRAM_CHANNEL = settings['telegram']['channel']

logger = utils.setup_logger("lm-reinvest" + log_id, logging.INFO, log_to_console, log_to_file)
utils.LOGGER = logger

assets = lm_pair.split("-")
asset_a = assets[0]
asset_b = assets[1]

utils.send_telegram(f"starting to reinvest in DFI-DUSD")
logger.info(f"starting to reinvest in pair {asset_a}-{asset_b}. Will reinvest if DFI reaches {min_reinvest}")

try:
    while asset_a == "DUSD":
        balance_DFI = utils.get_balance(address, "DFI")
        if balance_DFI > min_reinvest:
            amount_to_swap = balance_DFI / 2

            data = {
                "from": address,
                "tokenFrom": asset_b,
                "amountFrom": amount_to_swap,
                "to": address,
                "tokenTo": asset_a
            }

            logger.info(
                f"{rpc('getblockcount')} initiating swap "
                f"{round(amount_to_swap, 3)}@{asset_b}")
            tx_id = rpc("compositeswap", [data, utils.get_tx_input(address)])
            waitForTx(tx_id)
            
            blockcount = rpc('getblockcount')

            # get information about pool
            pool = utils.get_pool(lm_pair)

            # get current balances for DFI
            needed_DFI = utils.get_balance(address, "DFI")

            # calculate how many DUSD are needed, based on LM-pool
            needed_DUSD = pool['reserveA/reserveB'] * needed_DFI

            # check if enough balances are around, otherwise reverse calculations
            balance_DUSD = utils.get_balance(address, "DUSD")
            if balance_DUSD < needed_DUSD:
                logger.info(f"{blockcount} reversing calculations $ {balance_DUSD} < {needed_DUSD}")
                # we need to reverse calculations, as we have not enough DUSD on our address
                needed_DUSD = balance_DUSD
                needed_DFI = pool['reserveB/reserveA'] * needed_DUSD

                # just for safety reasons
                balance_DFI = utils.get_balance(address, "DFI")
                if balance_DFI < needed_DFI:
                    logger.info(f"{blockcount} DFI {balance_DFI} < {needed_DFI}")
                    logger.info(f"{blockcount} DFI -> DUSD and DUSD -> DFI calculations failed")
                    utils.send_telegram(f"failed reinvesting due to calculations failing")
                    raise ValueError

            # adding to LM pool
            logger.info(
                f"{blockcount} done, adding liquidity "
                f"{round(needed_DUSD, 3)}@{asset_a}, {round(needed_DFI, 3)}@{asset_b}")
            data = {address: ["%.8f@%s" % (needed_DUSD, asset_a),
                              "%.8f@%s" % (needed_DFI, asset_b)]
                    }
            tx_id = rpc("addpoolliquidity", [data, address, utils.get_tx_input(address)])
            waitForTx(tx_id)
            logger.info(f"{rpc('getblockcount')} done ")
            utils.send_telegram(f"done reinvesting {round(needed_DUSD, 3)} {asset_a} and {round(needed_DFI, 3)} {asset_b}")

        sleep(60)
except Exception as e:
    logger.error("uncaught exception: "+str(e))
    utils.send_telegram("lm-reinvest: Exception in script!")
