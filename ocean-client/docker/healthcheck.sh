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

script_status_file=/dev/tmp/healtcheck
vm_status_file=/root/.vault-maxi/status.txt

file_age=1  # minutes

#### Functions #################################################################################################

if [[ -f /root/.vault-maxi/status.txt ]]
then
   find $vm_status_file -newermt "${file_age} minutes ago" | read
else
   find $script_status_file -newermt "${file_age} minutes ago" | read
fi
