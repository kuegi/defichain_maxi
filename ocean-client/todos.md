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
* [ ] ?use additional LMToken/loans in case that wanted dtoken is used up, but collateral still low and more LPTokens available
* [X] ?recover from state
* [ ] use getRemainingTimeInMillis() to avoid hardcut timeouts
* [X] check and handle empty vault
* [X] errorhandling in case the seedparameter is missing
* [X] add environment variable for log-id (to add to the telegram prefix to distinguish different bots in different regions)
* [X] make desktop bech32 adresses possible
* [X] add min/max value to log message
* [X] improve log on ocean-timeout
* [X] allow increase directly after reinvest (no wait for next trigger)
* [X] run script directly after clean up (timeout shouldn't be an issue, not to waist time for actions)
* [X] switch all calculations to BigNumber to prevent rounding error
* [X] remove all exposure on maxCollateralRatio < 0
* [X] retry send tx also on other ocean error. cause might be due to inconsistency in ocean
* [X] run lambda in loop to retry on timeout error
* [X] remove all exposure when vault is frozen

* [X] fallback values in case of wrong userinput (ranges)
* [X] reduce ocean calls (also less frequent check in waitForTx)
* [X] always safe waitingTx in state (also in case of error)
* [X] add current safety value to status log
* [X] do errorhandling (aka cleanup) also during halted vaults.

* [X] check handling of vault getting started on halted token (no valid active price)

* [ ] single mint version
* [ ] add "skip" parameter to skip one execution (used by add ons)