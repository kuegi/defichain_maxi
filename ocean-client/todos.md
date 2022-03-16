# List of todos
* [x] clean up functionality
* [X] send multiple tx in one block to reduce timeout-risk
* [X] add check if enough LP-token and loans are available to reduce exposure to at least 2xminLoanScheme, otherwise send warning 
* [X] reinvest functionality
* [X] use min(currentRatio,nextRatio) to anticipate next update
* [X] change telegram notification to prefix with `[VaultMaxi]`
* [X] check for address in the wallet (not only first address) so that new address in wallet works
* [X] rules in CloudFormationTemplate to not allow empty address / vault
* [X] error handling: currently an error in the promises is not caught. should to a catch around everything in the main program. so we at least report the error. (not only in the log)
* [X] add telegram message on reinvest to remind user what they gained from using the bot and recommend donating some.
* [ ] refactor to jellyfish
* [ ] status message every day at 9 am
* [ ] use additional LMToken/loans in case that wanted dtoken is used up, but collateral still low and more LPTokens available
* [ ] allow multiple dToken (split liquidity evenly across them)
* [ ] recover from state
* [ ] use getRemainingTimeInMillis() to avoid hardcut timeouts
* [ ] check and handle empty vault
* [X] errorhandling in case the seedparameter is missing
* [ ] add environment variable for log-id (to add to the telegram prefix to distinguish different bots in different regions)
* [ ] make desktop bech32 adresses possible
* [ ] add min/max value to log message