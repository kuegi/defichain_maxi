import json
import logging
import sys
import traceback
from time import sleep

import utils

sourceToken = "USDC"
targetToken = "DUSD"
totalAmount = 0
batchSize = 2000
address = ""
maxPrice = 1.016

logToConsole = True
logToFile = False
# TODO: read from settings

'''
sample settings:
{
  "NODE_USER":   "RPC_USER",
  "NODE_PASSWORD": "RPC_Password",

  "address":"yourAddress",
  "sourceToken": "USDC",
  "targetToken": "DUSD",
  "totalAmount: 10,
  "batchSize": 1,
  "maxPrice": 1.02,
  
  "telegram": {
    "token": "telegramBot:Token",
    "channel": "channelToSendMessagesTo"
  },
  "logToConsole": true,
  "logToFile": true
}
'''

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
        address = settings['address']
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
        sourceToken = settings["sourceToken"]
        targetToken = settings["targetToken"]
        totalAmount = settings["totalAmount"]
        batchSize = settings["batchSize"]
        maxPrice = settings["maxPrice"]

logger = utils.setup_logger("tradebot_" + logId, logging.INFO, logToConsole=logToConsole, logToFile=logToFile)
utils.LOGGER = logger

logger.info(
    f"starting to trade. trying to swap {totalAmount} {sourceToken} into {targetToken} with maxPrice {maxPrice}")

openAmount = totalAmount
try:
    while openAmount > 0:
        balance = utils.get_balance(address, sourceToken)
        if balance < batchSize:
            logger.error(f"not enough balance in adress! {balance} < {batchSize}! quitting")
            break

        data = {
            "from": address,
            "tokenFrom": sourceToken,
            "amountFrom": batchSize,
            "to": address,
            "tokenTo": targetToken,
            "maxPrice": maxPrice
        }
        test_result = utils.rpc("testpoolswap", [data, "auto"])
        if test_result is not None:
            logger.info(f"{utils.blockcount()} trying swap on testresult {test_result}")
            tx = utils.rpc("compositeswap", [data])
            success = utils.waitForTx(tx)
            if success:
                logger.info(f"{utils.blockcount()} successfully swapped batch")
                utils.send_telegram("tradebot successfully swapped a batch")
                openAmount = openAmount - batchSize
            else:
                utils.rpc("removeprunedfunds", [tx])
                logger.info(f"{utils.blockcount()} failed to swap batch")

        sleep(10)

    logger.info(f"tradebot finished")
    utils.send_telegram("tradebot finished")
except Exception as e:
    logger.error("uncaught exception: " + str(e) + "\n" + traceback.format_exc())
    utils.send_telegram("tradebot: Exception in script!")
    raise e
