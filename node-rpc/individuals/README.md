# Individuals

are standalone scripts which automate some specific area, you might want to use.

## Available scripts
- portfolio allocator
- needed DUSD calculator

### Portfolio allocator
You define via a JSON how your current balance (as DFI-token) should be splitted and allocated in different dTokens. This script has an execution part, which needs to be confirmed.

What it does step by step:
1. look at your DFI token balance
2. read your specified JSON
3. calculate how much DFI need to be swapped to specified dToken to match allocation
4. print a detailed plan on how your DFI are splitted
5. you will need to confirm to printed plan
6. confirm => plan will be executed, anything else => script will be stopped

In `demo.json` are all available properties.
- `NODE_USER, NODE_PASSWORD` your username + password for your node
- `sourceAddress` address where DFI token will be taken from
- `destinationAddress` address where the dTokens will be swapped to
- `portfolio` an array of `token` to `allocation` objects
- `shouldExecute` as the name indicates, if `true` will execute swaps on confirmation, otherwise will just print swap command data

### Needed DUSD calculator
You might have different dTokens in your `destinationAddress` available and want to know how many DUSD you would need to add them to the respective LM pools. There is no auto-execution in this script, as you need to decide where those needed DUSD will come from.

What it does step by step:
1. look at all your available dTokens
2. for every dToken calculate how many DUSD would be needed (if above 1 DUSD)
3. print plan & all commands for addpoolliquidity

In `demo.json` are all available properties.
- `NODE_USER, NODE_PASSWORD` your username + password for your node
- `destinationAddress` address to look for dTokens