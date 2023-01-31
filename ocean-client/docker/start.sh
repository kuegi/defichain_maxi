#!/bin/bash

# ToDo:
#  - 

#### Settings ##################################################################################################

#settings_file=/root/.vault-maxi/settings.json
#seed_file_enc=
#seed_file_dec=

################################################################################################################

find /root -type d -exec chmod 700 {} +
find /root -type f -exec chmod 600 {} +

touch /root/.vault-maxi/seed.txt

node /root/app/index.js

while true
do
   node /root/app/index.js run 2>&1
   sleep ${TRIGGER_MINS}m
done

exit 0
