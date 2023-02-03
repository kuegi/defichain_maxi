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

settings_file=/root/.vault-maxi/settings.json
seed_file=/root/.vault-maxi/seed.txt

app_path=/root/app/
app_settings_check=index.js
app_run='index.js run'

seed_creation_prompt='Enter your 24 seed words separated by comma -> word1,word2,...,word24:'
seed_creation_hint='Copy the output and paste it into docker-compose.yml as value of the environment variable XX_CFG_EncryptedSeed.'

#### Functions #################################################################################################

function sleep_cycle(){
   echo "Next run at: "$(date -d "+ ${TRIGGER_MINS} minutes")

   sleep ${TRIGGER_MINS}m
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
   # run vault maxi
   node $app_path$app_run
}

function process_info(){
   echo "Working on"
   echo "########################################################################################################"
   echo "Adress: "$address
   echo "Vault: "$vault
   echo "Collaterial target range: "$minCollateralRatio" - "$maxCollateralRatio
   echo "LM-Pair: d"$LMToken"-dUSD"
   echo "Main Collateral Asset: "$mainCollateralAsset
   echo "Reinvest Threshold: "$reinvestThreshold
   echo ""
}

function set_env_vars(){
   if [[ ! -z $MaxReinvest ]]; then export VAULTMAXI_MAXREINVEST=$MaxReinvest;fi
   if [[ ! -z $LogID ]]; then export VAULTMAXI_LOGID=$LogID;fi
   if [[ ! -z $KeepClean ]]; then export VAULTMAXI_KEEP_CLEAN=$KeepClean;fi
   if [[ ! -z $OceanUrl ]]; then export VAULTMAXI_OCEAN_URL=$OceanUrl;fi
   if [[ ! -z $VaultSafetyOverride ]]; then export VAULTMAXI_VAULT_SAFETY_OVERRIDE=$VaultSafetyOverride;fi
}

function encrypt_seed_interactive(){
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

   exit 1
}

#### Regular Script Start ######################################################################################

# call function to encrypt the seed
if [[ $1 == "create_seed_string" ]]
then
   encrypt_seed_interactive
fi

# setup tmpfs folder
setup_tmpfs_folder

# start normal loop
while true
do
   for setting in $(seq -w 1 $MAX_SETTINGS)
   do
      # handover env vars
      var="CFG_${setting}_LogID"; LogID=${!var}
      var="CFG_${setting}_chatId"; chatId=${!var}
      var="CFG_${setting}_token"; token=${!var}
      var="CFG_${setting}_logChatId"; logChatId=${!var}
      var="CFG_${setting}_logToken"; logToken=${!var}
      var="CFG_${setting}_address"; address=${!var}
      var="CFG_${setting}_vault"; vault=${!var}
      var="CFG_${setting}_EncryptedSeed"; EncryptedSeed=${!var}
      var="CFG_${setting}_minCollateralRatio"; minCollateralRatio=${!var}
      var="CFG_${setting}_maxCollateralRatio"; maxCollateralRatio=${!var}
      var="CFG_${setting}_LMToken"; LMToken=${!var}
      var="CFG_${setting}_mainCollateralAsset"; mainCollateralAsset=${!var}
      var="CFG_${setting}_reinvestThreshold"; reinvestThreshold=${!var}
      var="CFG_${setting}_stableArbBatchSize"; stableArbBatchSize=${!var}
      var="CFG_${setting}_MaxReinvest"; MaxReinvest=${!var}
      var="CFG_${setting}_VaultSafetyOverride"; VaultSafetyOverride=${!var}
      var="CFG_${setting}_OceanUrl"; OceanUrl=${!var}
      var="CFG_${setting}_KeepClean"; KeepClean=${!var}

      # check if needed variables are set
      if [[ ! -z $address || ! -z $vault || ! -z $EncryptedSeed || ! -z $LMToken ]]
      then
         set_env_vars

         process_info

         create_tmp_setting_file
         create_tmp_seed_file $(decrypt_seed $EncryptedSeed)

         process_vault

         clear_vaultmaxi_folder
      fi

   done

   echo ""

   sleep_cycle

done

exit 0
