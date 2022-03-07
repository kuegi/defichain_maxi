# defichain_maxi
This is the "lightwallet" version of the defichain-maxi script. It has the same functionality but uses the ocean-api. Therefore no own server or full-node is needed.
Best way to run it is as a lambda function on AWS. There you can define trigger to execute it every 10 minutes for example.

In general the script checks the provided vault, if the collateral ratio is above the threshold it takes loans in DUSD and the defined dToken so that the collateral ratio comes into the range. The minted tokens will be put into the LM pool to produce rewards.
If the collateral ratio falls below the defined threshold, LM-tokens are removed from the pool and loans in the vault are payed back to get the ratio back within the wanted range. With this the vault produces optimized rewards on the collateral.

# Disclaimer / WARNING
Do not use this tool if you don't understand vaults on defichain. If you set the wrong parameter, you risk liquidating your vault and losing the whole collateral.

Of course, this is not financial advice! We do not take any responsibility for lost funds. Only invest money that you are willing to lose.

## Donations
We are developing this thing in our free time. Noone is paying us for it. If you benefit from our work, it would be a nice gesture to give something back. Here are our DFI donation addresses:

kügi: df1qqtlz4uw9w5s4pupwgucv4shl6atqw7xlz2wn07

krysh: dZ69fTXJ15YyDKCjAxTKqJ9qx2iV5Yq7cS

# Build & preparing for upload
We recommend running it as a lambda on AWS. with reasonable settings (trigger every 10 minutes) you will even stay within the free tier of AWS.

to build it run:
```
npm i
npm run build --file=vault-maxi
```

# Settings
To run, the script needs parameters set in the AWS ParameterStore:
```
/defichain-maxi/wallet/address
/defichain-maxi/wallet/vault
/defichain-maxi/settings/min-collateral-ratio
/defichain-maxi/settings/max-collateral-ratio
/defichain-maxi/settings/lm-token
```
saved as a SecureString:
```
/defichain-maxi/wallet/seed
```
optional parameters (if you want telegram notifications)
```
/defichain-maxi/telegram/notifications/chat-id
/defichain-maxi/telegram/notifications/token
/defichain-maxi/telegram/logs/chat-id
/defichain-maxi/telegram/logs/token
```


