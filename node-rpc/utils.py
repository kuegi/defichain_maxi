import json
import logging
import logging.handlers
import sys

import math
import os
import random

import requests

from time import sleep

NODE_URL = "http://127.0.0.1:8555/"
NODE_USER = "satoshi"
NODE_PASSWORD = "hunter12"

TELEGRAM_TOKEN = None
TELEGRAM_CHANNEL = None

LOGGER = None
logId = None


def floor(number, digits):
    return math.floor(number * math.pow(10, digits)) / math.pow(10, digits)


def smart_format(number, target_digit=5):
    log = min(math.log10(number), target_digit)
    return ("%0." + str(int(target_digit - log)) + "f") % number



# ================================ Logging =========================================

def setup_logger(name="kuegi_defi", log_level=logging.INFO,
                 logToConsole=True, logToFile=False):
    logger = logging.getLogger(name)
    logger.setLevel(log_level)
    if len(logger.handlers) == 0:
        if logToConsole:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(fmt='\r%(asctime)s - %(levelname)s:%(name)s - %(message)s'))
            logger.addHandler(handler)

        if logToFile:
            base = 'logs/'
            try:
                os.makedirs(base)
            except Exception:
                pass
            fh = logging.handlers.RotatingFileHandler(base + name + '.log', mode='a', maxBytes=200 * 1024,
                                                      backupCount=50)
            fh.setFormatter(logging.Formatter(fmt='%(asctime)s - %(levelname)s - %(message)s'))
            fh.setLevel(logging.INFO)
            logger.addHandler(fh)

    return logger


def send_telegram(message):
    if TELEGRAM_TOKEN is not None and TELEGRAM_CHANNEL is not None:
        if logId is not None:
            message = str(logId) + ": " + message
        url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage?chat_id=' + TELEGRAM_CHANNEL + '&text=' + message

        result = requests.get(url).json()
        if not result["ok"] and LOGGER is not None:
            LOGGER.warning("error sending telegram messages " + str(result))


# ================================= ChainData =============================================

class PairInfo:
    def __init__(self, pair):
        self.pair = pair
        self.dex_price = 0
        self.oracle_price = 0
        self.next_oracle_price = 0
        self.live_oracle_price = 0

    def __str__(self):
        return " %s: %.2f vs %.2f (%.2f%%)" % (
            self.pair, self.dex_price, self.oracle_price, 100 * self.dex_price / self.oracle_price)


class ChainData:
    def __init__(self, useLivePrice=False):
        self.useLivePrice = useLivePrice
        self.dataByPair = {}
        self.dfiData = PairInfo("DFI")

    def pair(self, pair) -> PairInfo:
        if pair in self.dataByPair:
            return self.dataByPair[pair]
        else:
            return None

    def defipremium(self):
        if self.dfioracle() > 0:
            return self.dfiData.dex_price / self.dfioracle()
        else:
            return 1

    def dfioracle(self):
        return self.dfiData.live_oracle_price if self.useLivePrice else self.dfiData.oracle_price

    def premium_for_token(self, token):
        return self.premium_for_pair(token + "-DUSD")

    def oracle_for_token(self, token):
        if token + "-DUSD" not in self.dataByPair:
            return 0
        v = self.dataByPair[token + "-DUSD"]
        return v.live_oracle_price if self.useLivePrice else v.oracle_price

    def premium_for_pair(self, pair):
        if pair not in self.dataByPair:
            return 1
        v = self.dataByPair[pair]
        oracle = v.live_oracle_price if self.useLivePrice else v.oracle_price
        if oracle > 0 and self.dfioracle() > 0:
            return (v.dex_price / oracle) / self.defipremium()
        else:
            return 1


def calc_maxPrice_Amount(exchange_data, token, dfiAmount):
    premium = exchange_data.premium_for_token(token)
    v = exchange_data.dataByPair[token + "-DUSD"]
    maxPrice = floor(exchange_data.dfioracle() / (1.5 * v.oracle_price), 8)
    amount = floor(dfiAmount * maxPrice, 7)  # to prevent floating problems on max positionsize
    bestPrice = exchange_data.dfiData.dex_price / v.dex_price
    return [premium, maxPrice, bestPrice, amount]


def updateData(data):
    pools = rpc('listpoolpairs')
    for pool in pools.values():
        if pool['symbol'] == 'DUSD-DFI':
            data.dfiData.dex_price = pool['reserveA/reserveB']  # DFI-DUSD price is flipped to the others!
        elif pool['symbol'] in data.dataByPair.keys():
            data.dataByPair[pool['symbol']].dex_price = pool['reserveB/reserveA']

    prices = rpc('listfixedintervalprices')
    for price in prices:
        pair = price['priceFeedId'].replace("/", "-D")
        if price['isLive']:
            activePrice = price['activePrice']
            predicted = price['nextPrice']
        else:
            activePrice = 0
            predicted = price['nextPrice']
        if price['priceFeedId'] == "DFI/USD":
            data.dfiData.oracle_price = activePrice
            data.dfiData.next_oracle_price = predicted
        elif pair in data.dataByPair.keys():
            data.dataByPair[pair].oracle_price = activePrice
            data.dataByPair[pair].next_oracle_price = predicted

    prices = rpc('listprices')
    for price in prices:
        if price['currency'] == 'USD' and price['ok']:
            pair = price['token'] + "-DUSD"
            if price['token'] == "DFI":
                data.dfiData.live_oracle_price = price['price']
            elif pair in data.dataByPair.keys():
                data.dataByPair[pair].live_oracle_price = price['price']

# ===================================== RPC Stuff ===================================


def blockcount():
    return rpc("getblockcount")

def get_tx_input(address, minamount=0.001, count= 1):
    # get a random utxo (helps preventing problems when multiple scripts use the same address)
    unspent = rpc("listunspent", [1, 9999999, [address], False, {"minimumAmount": round(minamount, 8)}])
    if len(unspent) == 0:
        return []
    unspent_sample= random.sample(unspent,min(len(unspent),count))
    result= []
    for tx in unspent_sample:
        result.append({'txid': tx["txid"], "vout": tx["vout"], "amount": tx["amount"]})
    return result

def is_tx_confirmed(txId):
    if txId is None:
        return False
    tx = rpc('gettransaction', [txId])
    if tx:
        return "blockhash" in tx
    return False

def rpc(method, params=None, silentErrors=False):
    if params is None:
        params = []
    data = json.dumps({
        "jsonrpc": "2.0",
        "id": "meBe",
        "method": method,
        "params": params
    })
    result = requests.post(NODE_URL, auth=(NODE_USER, NODE_PASSWORD), data=data)
    if result.status_code >= 300 and not silentErrors:
        message = f"--Error in RPC Call {method} with {str(params)}:\n{result.json()['error']['message']}"
        if LOGGER:
            LOGGER.error(message)
        else:
            print("\r" + message)
        send_telegram(f"Error in RPC Call {method}: {result.json()['error']['message']}")
    return result.json()['result']


def waitForTx(txId, loopSleep=1.0, timeoutBlocks=30):
    if txId is None:
        return False
    height = rpc('getblockcount')
    lastBlock = height + timeoutBlocks
    tx = rpc('gettransaction', [txId])
    while tx is not None and ("blockhash" not in tx) and (timeoutBlocks <= 0 or height <= lastBlock):
        print(f"\r{height} waiting for tx", end="")
        sleep(loopSleep)
        tx = rpc('gettransaction', [txId])
        height = rpc('getblockcount')
    return tx is not None and (timeoutBlocks <= 0 or height <= lastBlock)

def waitBlocks(numberOfBlocks, loopSleep= 1.0):
    height = rpc('getblockcount')
    lastBlock = height + numberOfBlocks
    while height < lastBlock:
        print(f"\r{height} waiting ", end="")
        sleep(loopSleep)
        height = rpc('getblockcount')

def get_account(address):
    balances = {}
    tokenbalances = rpc("getaccount", [address])
    for entry in tokenbalances:
        t = entry.split("@")
        balances[t[1]] = float(t[0])
    return balances


def get_balance(address, token):
    balances = get_account(address)
    if token in balances:
        return balances[token]
    return 0


def get_pool(pool):
    pools = rpc("getpoolpair", [pool])
    for pool in pools.values():
        return pool
    return None
