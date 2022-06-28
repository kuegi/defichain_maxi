import json
import logging
import sys

from .. import utils

errortimeout = 5  # blocks

address = "destination-address"

settingsPath = sys.argv[1] if len(sys.argv) > 1 else None
# Krysh: This is a one time call and without running a service behind it.
settingsPath += ".json"
# read settings
if settingsPath is not None:
    print("Importing settings from %s" % settingsPath)
    with open(settingsPath) as f:
        settings = json.load(f)
        utils.NODE_USER = settings['NODE_USER']
        utils.NODE_PASSWORD = settings['NODE_PASSWORD']
        address = settings['destinationAddress']

logger = utils.setup_logger("", logging.INFO, True, False)
utils.LOGGER = logger


def build_command(token: str, amount: float, needed_dusd: float):
    return "defi-cli addpoolliquidity '{\"" + address + "\":[\"" + str(amount) + "@" + token + "\",\"" + str(needed_dusd) + "@DUSD\"]}' \"" + address + "\"\n"


balances = utils.get_account(address)
logger.info(balances)
needed_dusd_plan = ""
commands = ""
overall_needed_dusd = 0.0
for token in balances.keys():
    if token != "DUSD" and token != "DFI" and "-DUSD" not in token and "-DFI" not in token:
        if token == "BTC":
            print("doing nothing for BTC")
            # TODO: calculate how many DFI are needed to get BTC into LM
        else:
            pool_id = f"{token}-DUSD"
            pool = utils.get_pool(pool_id)
            needed_dusd = utils.floor(balances[token] * pool["reserveB/reserveA"], 8)
            if needed_dusd > 1:
                commands += build_command(token, balances[token], needed_dusd)
                overall_needed_dusd += needed_dusd
                needed_dusd_plan += f"{token}: {needed_dusd} DUSD\n"

print(f"\n{address} neededs following DUSD amounts to add open tokens into LM" +
      f"\noverall needed DUSD are {overall_needed_dusd}" +
      f"\n\n{needed_dusd_plan}" +
      f"\n\n{commands}")
