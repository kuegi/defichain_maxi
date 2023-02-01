#!/bin/bash

# ToDo:
#  - encrypt seed after first use of container
#  - allow more than one settings.json to control more than one vault
#  - write ordinary readme
#  - check defichain_maxi/ocean-client/src/utils/store_config.ts and add missing config paramters

#### Settings ##################################################################################################

path_extern=/root/.vault-maxi-ext/

first_settings_file=/root/.vault-maxi-ext/settings_01.json
first_seed_file_unenc=/root/.vault-maxi-ext/seed_01.unencrypted
first_seed_file_enc=/root/.vault-maxi-ext/seed_01.encrypted

internal_settings_file=/root/.vault-maxi/settings.json

settings_file_filter=settings_*.json

app_path=/root/app/
app_settings_check=index.js
app_run=index.js run

################################################################################################################

# function definitions
function set_dir_and_file_permissions(){
   find /root -type d -exec chmod 700 {} +
   find /root -type f -exec chmod 600 {} +
}

function create_inital_files(){
   node $app_path$app_settings_check
   cp -a $internal_settings_file $first_settings_file
   touch $first_seed_file_unenc
}

function sleep_cycle(){
   sleep ${TRIGGER_MINS}m
}

function encrypt_seed($file){
   openssl enc -aes-256-cbc -pbkdf2 -iter 20000 -in unenc.txt -out enc.txt -k passwd
}

function decrypt_seed($enc_file, $unenc_file){
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 20000 -in $enc_file -out $unenc_file -k $SEED_ENCRYPTION_PASSPHRASE
}


# script start

if [[ ! -f "first_settings_file" ]];
then
   create_inital_files
   set_dir_and_file_permissions
   sleep_cycle
else
   for setting in $settings_file_filter
   do

   done
fi

while true
do
   for setting in $settings_file_filter
   do
      echo -E "Working on: "${setting}"\n"



      node $app_path$app_run 2>&1
      set_dir_and_file_permissions
      sleep_cycle




   done
done

exit 0
