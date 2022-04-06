import json
import logging
import sys

import utils
from .. import utils

errortimeout = 5  # blocks

source_address = "source-address"
destination_address = "destination-address"
should_execute = False
portfolio = []

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
        source_address = settings['sourceAddress']
        destination_address = settings['destinationAddress']
        should_execute = settings['shouldExecute']
        portfolio_to_read = settings['portfolio']
        for item in portfolio_to_read:
            portfolio.append((item['token'], item['allocation']))

logger = utils.setup_logger("", logging.INFO, True, False)
utils.LOGGER = logger


def build_command_data(balance: float, token: str, allocation: float):
    return {
        "from": source_address,
        "tokenFrom": "DFI",
        "amountFrom": str(utils.floor(balance * allocation, 8)),
        "to": destination_address,
        "tokenTo": token
    }


dfi_balance = utils.get_balance(source_address, "DFI")
command_data = []
allocation_plan = ""
overall_allocation = 0.0
for token, allocation in portfolio:
    overall_allocation += allocation
    data = build_command_data(dfi_balance, token, allocation)
    allocation_plan += token + ": " + \
        str(allocation * 100) + "% (" + str(data["amountFrom"]) + " DFI)\n"
    command_data.append(data)

print(f"\n{source_address} --> {destination_address}" +
      "\nDFI balance: " + str(dfi_balance) +
      "\noverall allocation plan is " + str(overall_allocation * 100) + "%\n" +
      allocation_plan)
key = input("Please review plan and press y and enter to continue... ")
if key != "y":
    print("allocator: aborted")
    exit(0)

for data in command_data:
    if should_execute:
        logger.info(f"{utils.rpc('getblockcount')} initiating swap "
                f"{data['amountFrom']}@DFI to {data['tokenTo']} on {data['to']}")
        utils.rpc("compositeswap", [data])
    else:
        print(data)
