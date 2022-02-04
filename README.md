# defichain_maxi
This script is made to optimize your defichain vault rewards by maximizing the amount of loans put into the liquidity mining of dTokens.
You can define the thresholds for your collateralization ratio. if the collateral rises, the script increases LM-exposure, if it falls it automatically decreases it.

If the `reinvest` is set in the settings, it will automatically reinvest DFI rewards from the address as soon as they go over that threshold. 

The first version needs a full node with activated rpc to run. I might do a version using the Ocean API later on.

# Disclaimer / WARNING
This is no beginners tool. I only recommend it for ppl who know what they are doing and have experience in running a 24/7 server.
If you don't understand what the code does and what the risks are, you will probably loose money.
Don't ever blame me for losing money yourself ;)

And of course, this is not financial advice!

# Running it on a server
I have this script running on a server for 2 months now. I use  [DigitalOcean](https://m.do.co/c/1767a7ee58ea) for it because of their simplicity.
You need a server with at least 4GB of RAM (to run the defichain fullnode on it). Such a server costs around 20$/month on DigitalOcean.
If you wanna check it out, feel free to use the [reflink](https://m.do.co/c/1767a7ee58ea). You also get 100$ to test their service for 2 months, which lets you test everything you need without any cost basically.

# donations
If this script or parts of it help you make more rewards, feel free to give something back:

DFI address: dLBqjysPVXYQX4dFSp5hMWdVfbdeY4aHVS
BTC: bc1qfdm2z0xpe7lg70try8x3n3qytrjqzq5y2v6d5n
