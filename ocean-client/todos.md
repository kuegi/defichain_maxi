# List of todos
* [x] clean up functionality
* [ ] send multiple tx in one block to reduce timeout-risk
* [ ] add check if enough LP-token and loans are available to reduce exposure to at least 2xminLoanScheme, otherwise send warning 
* [X] reinvest functionality
* [X] use min(currentRatio,nextRatio) to anticipate next update
* [ ] refactor to jellyfish
* [X] change telegram notification to prefix with `[VaultMaxi]`
* [ ] status message every day at 9 am
* [X] check for address in the wallet (not only first address) so that new address in wallet works
* [ ] rules in CloudFormationTemplate to not allow empty address / vault
* [ ] use additional LMToken/loans in case that wanted dtoken is used up, but collateral still low and more LPTokens available
* [ ] allow multiple dToken (split liquidity evenly across them)
* [ ] recover from state
* [ ] use getRemainingTimeInMillis() to avoid hardcut timeouts
