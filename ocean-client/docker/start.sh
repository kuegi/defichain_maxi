#!/bin/bash

# ToDo:
#  - encrypt seed after first use of container
#  - allow more than one settings.json to control more than one vault
#  - write ordinary readme
#  - check defichain_maxi/ocean-client/src/utils/store_config.ts and add missing config paramters

# Notices:
#  Ablauf:
#  1. Docker mount leer -> vault-maxi inital run, kopiere init settings file in den mount, erstelle leere initial seed file im mount, permissions setzen, sleep
#  2. Inital Settings vorhanden, seed leer -> skippe diese abarbeitung
#  3. Settings vorhanden, seed unencrypted, passphrase definiert -> unverschlüsselte seeds verschlüsseln, setting abarbeiten
#  4. Settings vorhanden, seed unencrypted, passphrase nicht definiert -> seed unverschlüsselt lassen, setting abarbeiten, verschlüsselte seeds skippen, fehlermeldung nach stdout

#### Settings ##################################################################################################

path_extern=/root/.vault-maxi-ext/

inital_settings_file=/root/.vault-maxi-ext/settings_Name01.json
inital_seed_file_unenc=/root/.vault-maxi-ext/seed_Name01.txt

internal_vaultmaxi_folder=/root/.vault-maxi
tmpfs_vaultmaxi_folder=/dev/vault-maxi

internal_settings_file=/root/.vault-maxi/settings.json
internal_seed_file=/root/.vault-maxi/seed.txt

settings_file_filter=settings_*.json

app_path=/root/app/
app_settings_check=index.js
app_run='index.js run'

################################################################################################################

# function definitions
function set_root_dir_and_file_permissions(){
   find /root -type d -exec chmod 700 {} +
   find /root -type f -exec chmod 600 {} +
}

function create_inital_files(){
   node $app_path$app_settings_check
   cp -a $internal_settings_file $inital_settings_file
   touch $inital_seed_file_unenc
}

function sleep_cycle(){
   sleep ${TRIGGER_MINS}m
}

# encrypt_seed $in $out
function encrypt_seed(){
   openssl enc -aes-256-cbc -pbkdf2 -iter 20000 -in $1 -out $2 -k $SEED_ENCRYPTION_PASSPHRASE
   rm $1
}

# decrypt_seed $in $out
function decrypt_seed(){
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 20000 -in $1 -out $2 -k $SEED_ENCRYPTION_PASSPHRASE
}

function setup_tmpfs_folder(){
   mkdir $tmpfs_vaultmaxi_folder
   ln -s $tmpfs_vaultmaxi_folder $internal_vaultmaxi_folder
}

# process_vault $seed($1) $setting($2) $settings_name($3)
function process_vault(){
   # handling decrypt
   if [[ ! -z "$SEED_ENCRYPTION_PASSPHRASE" ]]
   then
      decrypt_seed $1 $internal_seed_file
   else
      cp $1 $internal_seed_file
   fi

   # handling settings.json
   cp $2 $internal_settings_file
   sed 's/  "seedfile": ".*/  "seedfile": "\/root\/.vault-maxi\/seed.txt",/g' -i $internal_settings_file

   # set VAULTMAXI_LOGID env var
   export VAULTMAXI_LOGID=$3

   # run vault maxi
   node $app_path$app_run

   # clear internal vault maxi folder
   rm ${internal_vaultmaxi_folder}/*
}


# script start

setup_tmpfs_folder

# create inital files
if [[ -z "$(ls -A $path_extern)" ]]
then
   create_inital_files
   set_root_dir_and_file_permissions
   sleep_cycle
fi

while true
do
   for setting in $path_extern$settings_file_filter
   do
      settings_name=$(echo $setting | awk -F'_' '{print $2}' | sed s/.json//g)

      echo $setting
      echo $settings_name

      if [[ ! -s ${path_extern}"seed_"${settings_name}".txt" && ! -f ${path_extern}"seed_"${settings_name}".enc" ]]
      then
         echo "seed empty, not encrypted -> skip setting, stdout error msg"

      elif [[ -s ${path_extern}"seed_"${settings_name}".txt" && ! -f ${path_extern}"seed_"${settings_name}".enc" && ! -z "$SEED_ENCRYPTION_PASSPHRASE" ]]
      then
         echo "seed not empty, not encrypted, passphrase is set -> encrypt seed, process vault"
         encrypt_seed ${path_extern}"seed_"${settings_name}".txt" ${path_extern}"seed_"${settings_name}".enc"
         process_vault ${path_extern}"seed_"${settings_name}".enc" $setting $settings_name

      elif [[ -s ${path_extern}"seed_"${settings_name}".txt" && ! -f ${path_extern}"seed_"${settings_name}".enc" && -z "$SEED_ENCRYPTION_PASSPHRASE" ]]
      then
         echo "seed not empty, not encrypted, passphrase is not set -> process vault, warn that seed is unencrypted on stdout"
         process_vault ${path_extern}"seed_"${settings_name}".txt" $setting $settings_name

      elif [[ -f ${path_extern}"seed_"${settings_name}".enc" && ! -z "$SEED_ENCRYPTION_PASSPHRASE" ]]
      then
         echo "seed encrypted, passphrase is set -> process vault"
         process_vault ${path_extern}"seed_"${settings_name}".enc" $setting $settings_name

      elif [[ -f ${path_extern}"seed_"${settings_name}".enc" && -z "$SEED_ENCRYPTION_PASSPHRASE" ]]
      then
         echo "seed encrypted, passphrase is not set -> skip setting, stdout error msg"

      fi

   done

   echo " "
   
   set_root_dir_and_file_permissions
   sleep_cycle

done

exit 0
