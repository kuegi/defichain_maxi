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

krysh: df1qw2yusvjqctn6p4esyfm5ajgsu5ek8zddvhv8jm

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
/defichain-maxi/settings/reinvest
/defichain-maxi/state
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

# Advanced usage
Besides having parameters in the AWS ParameterStore, there is the possibility to set environment variables on a AWS Lambda execution.

Currently following keys are respected with a small description on how they alter execution functionality

## VAULTMAXI_LOGID
value: string

will be shown in the prefix of every telegram message. Meant to easily distinguish log messages of different bots

## VAULTMAXI_STORE_POSTIX
value: string

Extends name of following ParameterStore parameters with your value:
```
/defichain-maxi/wallet/address
/defichain-maxi/wallet/vault
/defichain-maxi/settings/min-collateral-ratio
/defichain-maxi/settings/max-collateral-ratio
/defichain-maxi/settings/lm-token
/defichain-maxi/settings/reinvest
/defichain-maxi/state
```
Example for value = -second
```
/defichain-maxi-second/wallet/address
/defichain-maxi-second/wallet/vault
/defichain-maxi-second/settings/min-collateral-ratio
/defichain-maxi-second/settings/max-collateral-ratio
/defichain-maxi-second/settings/lm-token
/defichain-maxi-second/settings/reinvest
/defichain-maxi-second/state
```
This will allow you to create a second lambda, with the code you built to run on a second address + vault

## DEFICHAIN_SEED_KEY
value: string

This value overwrites the default seed key parameter to another SecureString parameter, which is further used to initialise your wallet.

## VAULTMAXI_KEEP_CLEAN
value: string
possible values: `"true", "false"`

Enabled: keeps your address clean by using commissions (dust) to payback loans and adding liquidity to your pool-pair

Disabled: will not touch commissions (dust), only what is needed by default calculations

## VAULTMAXI_VAULT_SAFETY_OVERRIDE
value: number
possible values: `loanScheme.minColRatio < x < loanSchemen.minColRatio * 2`

### DISCLAIMER - only use this variable if you really know what you do, as this might risk your vault getting liquidated without a proper warning message

There is a warning if too less LM tokens of configured token is available to safeguard your vault. This might be because of having other loans within the very same vault.

To avoid getting spammed, because this is a calculated risk from you, you can change this safety warning to a lower ratio.

Example: Vault with MIN150 => minColRatio = 150
Safety warning will be raised if paying back all configured LM tokens will result in a collateral ratio of below 300. Setting this value to 250, will raise this warning to below 250.
