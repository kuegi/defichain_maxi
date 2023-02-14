#!/bin/bash

#########################################################################
#                                                                       #
#     Author:              RoMi1981                                     #
#     Github:              https://github.com/RoMi1981                  #
#                                                                       #
#     Website Vault-Maxi:  https://www.vault-maxi.live                  #
#     Github Vault-Maxi:   https://github.com/kuegi/defichain_maxi      #
#                                                                       #
#########################################################################

#### Settings ##################################################################################################

vaultmaxi_folder=/root/.vault-maxi
tmpfs_vaultmaxi_folder=/dev/vault-maxi

tmpfs_tmp_folder=/dev/tmp

healtcheck_file=/dev/tmp/healtcheck

settings_file=/root/.vault-maxi/settings.json
seed_file=/root/.vault-maxi/seed.txt

app_path=/root/app/
app_settings_check=index.js
app_run='index.js run'

seed_creation_prompt='Enter your 24 seed words separated by comma -> word1,word2,...,word24:'
seed_creation_hint='Copy the output and paste it into docker-compose.yml as value of the environment variable XX_CFG_EncryptedSeed.'

help_docker='Direct commands available: create_seed_string, check_config and help.'

#### Functions #################################################################################################

function heartbeat(){
   touch $healtcheck_file
}

function timestamp(){
   echo $(date +%s)
}

function sleep_cycle(){
   now=$(timestamp)
   next_run=$((start_timestamp+TRIGGER_MINUTES*60))

   if [[ $next_run > $now ]]
   then
      echo "Next run at: "$(date -d @$next_run)
   fi

   while [[ $next_run > $now ]]
   do
      now=$(timestamp)
      next_run=$((start_timestamp+TRIGGER_MINUTES*60))

      heartbeat

      sleep 1s
   done
}

# encrypt_seed $in
function encrypt_seed(){
   passphrase=$(openssl rand -base64 24)
   enc_seed=$(echo $1 | openssl enc -aes-256-cbc -pbkdf2 -iter 20000 -nosalt -a -A -pass pass:$passphrase)
   echo $enc_seed";"$passphrase
}

# decrypt_seed $in
function decrypt_seed(){
   passphrase=$(echo $1 | awk -F";" '{print $2}')
   in=$(echo $1 | awk -F";" '{print $1}')
   unenc_seed=$(echo $in | openssl enc -d -aes-256-cbc -pbkdf2 -iter 20000 -nosalt -a -A -pass pass:$passphrase)
   echo $unenc_seed
}

function setup_tmpfs_folder(){
   mkdir $tmpfs_tmp_folder

   mkdir $tmpfs_vaultmaxi_folder
   ln -s $tmpfs_vaultmaxi_folder $vaultmaxi_folder
}

function create_tmp_setting_file(){

cat << EOF >> $settings_file
{
  "chatId": "$chatId",
  "token": "$token",
  "logChatId": "$logChatId",
  "logToken": "$logToken",
  "address": "$address",
  "vault": "$vault",
  "seedfile": "$seed_file",
  "minCollateralRatio": $minCollateralRatio,
  "maxCollateralRatio": $maxCollateralRatio,
  "LMToken": "$LMToken",
  "mainCollateralAsset": "$mainCollateralAsset",
  "reinvestThreshold": $reinvestThreshold,
  "reinvestPattern": "$reinvestPattern",
  "stableArbBatchSize": $stableArbBatchSize
}
EOF

}

# create_tmp_seed_file $unenc_seed
function create_tmp_seed_file(){
   echo $1 > $seed_file
}

function clear_vaultmaxi_folder(){
   rm ${vaultmaxi_folder}/*
}

# process_vault
function process_vault(){
   node $app_path$app_run
}

# check settings
function check_vault_settings(){
   node $app_path$app_settings_check
}

function process_info(){
   echo "Working on:"
   echo "########################################################################################################"
   echo "LogID: "$LogID
   echo "Adress: "$address
   echo "Vault: "$vault
   echo "Collaterial target range: "$minCollateralRatio" - "$maxCollateralRatio
   echo "LM-Pair: d"$LMToken"-dUSD"
   echo "Main Collateral Asset: "$mainCollateralAsset
   echo "Reinvest Threshold: "$reinvestThreshold
   echo "Reinvest Pattern: "$reinvestPattern
   echo ""
}

function set_env_vars(){
   if [[ ! -z $MaxReinvest ]]; then export VAULTMAXI_MAXREINVEST=$MaxReinvest; else unset VAULTMAXI_MAXREINVEST;fi
   if [[ ! -z $LogID ]]; then export VAULTMAXI_LOGID=$LogID; else unset VAULTMAXI_LOGID;fi
   if [[ ! -z $KeepClean ]]; then export VAULTMAXI_KEEP_CLEAN=$KeepClean; else unset VAULTMAXI_KEEP_CLEAN;fi
   if [[ ! -z $OceanUrl ]]; then export VAULTMAXI_OCEAN_URL=$OceanUrl; else unset VAULTMAXI_OCEAN_URL;fi
   if [[ ! -z $VaultSafetyOverride ]]; then export VAULTMAXI_VAULT_SAFETY_OVERRIDE=$VaultSafetyOverride; else unset VAULTMAXI_VAULT_SAFETY_OVERRIDE;fi
}

# handover_env_vars $setting
function handover_env_vars(){
   var="CFG_${1}_SettingEnabled"; SettingEnabled=${!var}
   var="CFG_${1}_LogID"; LogID=${!var}
   var="CFG_${1}_chatId"; chatId=${!var}
   var="CFG_${1}_token"; token=${!var}
   var="CFG_${1}_logChatId"; logChatId=${!var}
   var="CFG_${1}_logToken"; logToken=${!var}
   var="CFG_${1}_address"; address=${!var}
   var="CFG_${1}_vault"; vault=${!var}
   var="CFG_${1}_EncryptedSeed"; EncryptedSeed=${!var}
   var="CFG_${1}_minCollateralRatio"; minCollateralRatio=${!var}
   var="CFG_${1}_maxCollateralRatio"; maxCollateralRatio=${!var}
   var="CFG_${1}_LMToken"; LMToken=${!var}
   var="CFG_${1}_mainCollateralAsset"; mainCollateralAsset=${!var}
   var="CFG_${1}_reinvestThreshold"; reinvestThreshold=${!var}
   var="CFG_${1}_reinvestPattern"; reinvestPattern=${!var}
   var="CFG_${1}_stableArbBatchSize"; stableArbBatchSize=${!var}
   var="CFG_${1}_MaxReinvest"; MaxReinvest=${!var}
   var="CFG_${1}_VaultSafetyOverride"; VaultSafetyOverride=${!var}
   var="CFG_${1}_OceanUrl"; OceanUrl=${!var}
   var="CFG_${1}_KeepClean"; KeepClean=${!var}
}

function help_docker_cmd(){
   echo $help_docker

   echo ""
   echo "Exiting..."

   exit 0
}

function encrypt_seed_interactive_docker_cmd(){
   echo $seed_creation_prompt
   echo ""
   read -e -p "Seed: " seed

   enc_seed=$(encrypt_seed $seed)

   echo ""
   echo $seed_creation_hint
   echo ""
   echo $enc_seed

   echo ""
   echo "Exiting..."

   exit 0
}

function check_config_docker_cmd(){
   setup_tmpfs_folder

   for setting in $(seq -w 1 99)
   do
      handover_env_vars $setting

      # check if needed variables are set
      if [[ ! -z $address || ! -z $vault || ! -z $EncryptedSeed || ! -z $LMToken ]]
      then
         set_env_vars

         process_info

         create_tmp_setting_file
         create_tmp_seed_file $(decrypt_seed $EncryptedSeed)

         echo "Settings file:"
         cat $settings_file

         echo ""

         check_vault_settings

         clear_vaultmaxi_folder

         echo ""

         read -p "Press enter to continue"
      fi

   done

   exit 0
}

#### Regular Script Start ######################################################################################

# call function to encrypt the seed
if [[ $1 == "create_seed_string" ]]
then
   encrypt_seed_interactive_docker_cmd
elif [[ $1 == "check_config" ]]
then
   check_config_docker_cmd
elif [[ $1 == "help" ]]
then
   help_docker_cmd
fi

setup_tmpfs_folder

heartbeat

check_cfg=0

# start normal loop
while true
do
   heartbeat

   start_timestamp=$(timestamp)

   for setting in $(seq -w 1 99)
   do
      heartbeat

      handover_env_vars $setting

      # check if needed variables are set
      if [[ ! -z $address && ! -z $vault && ! -z $EncryptedSeed && ! -z $LMToken ]]
      then
         set_env_vars

         process_info

         create_tmp_setting_file
         create_tmp_seed_file $(decrypt_seed $EncryptedSeed)

         if [[ $check_cfg == 1 ]]
         then
            if [[ $SettingEnabled == "true" ]]
            then
            process_vault
            else
               echo "Setting disabled, skip processing..."
            fi

         else
            check_vault_settings
         fi

         clear_vaultmaxi_folder

         echo ""
      fi

   done

   echo ""

   if [[ $check_cfg == 1 ]]
   then
      sleep_cycle
   else
      check_cfg=1
   fi

done

exit 0
