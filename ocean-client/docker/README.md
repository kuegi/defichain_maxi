## Docker vault-maxi

**Introduction**

Please make first sure to read the complete official vault-maxi documentation. 
You can find the manual here: https://www.vault-maxi.live -> Guide

This docker-compose stack uses local image build functions, i.e. no need to download an image from the docker hub.

All docker-compose commands must be executed in the project directory.

**Encrypt seed interactively**

    docker-compose run --build vault-maxi create_seed_string

Copy the displayed string into the docker-compose.yml:

    CFG_XX_EncryptedSeed=<encrypted_seed>

Unencrypted seeds will not work!

**Configuration**

The following settings are defined in the environment block of the docker-compose.yml file.

Run vault-maxi every x minutes:

    TRIGGER_MINUTES=10

Address and vault config block:

      ### Vault-Maxi Settings Block 01 - START ####################################################
      - CFG_01_SettingEnabled=true
      - CFG_01_LogID=Name01
      - CFG_01_chatId=
      - CFG_01_token=
      - CFG_01_logChatId=
      - CFG_01_logToken=
      - CFG_01_address=
      - CFG_01_vault=
      - CFG_01_EncryptedSeed=
      - CFG_01_minCollateralRatio=160
      - CFG_01_maxCollateralRatio=165
      - CFG_01_LMToken=MSFT
      - CFG_01_mainCollateralAsset=DFI
      - CFG_01_reinvestThreshold=1
      - CFG_01_stableArbBatchSize=-1
      - CFG_01_MaxReinvest=1
      # - CFG_01_VaultSafetyOverride=
      # - CFG_01_OceanUrl=
      # - CFG_01_KeepClean=
      ### Vault-Maxi Settings Block 01 - END ######################################################

Up to 99 such blocks can be created.
Please make sure to increase the consecutive number: CFG_01_ ... CFG_02_ ... CFG_99_ 
Attention must be paid to the correct indentation.

**Check config**

Before commissioning, it is recommended to check the configuration.

    docker-compose run --build vault-maxi check_config

This way, possible configuration errors can be excluded in advance.

 **Start vault-maxi container detached (normal)**

    docker-compose up --build -d

**Start vault-maxi container attached (for troubleshooting)**

    docker-compose run --build vault-maxi

**Show container instances**

    docker container ls [-a (all)]

**Display container logs/stdout**

    docker logs [-f (follow)] <container_name_or_id>

**Run a new vault-maxi version, update**

After a new version is released, you are able to run the container with a new version.
Edit the VAULT_MAXI_VERSION argument in the docker-compose.yml file, example:

From:

    VAULT_MAXI_VERSION: tags/v2.5.0

To:

    VAULT_MAXI_VERSION: tags/v2.5.1

Then restart the container with

    docker-compose up --build -d

**Container health check**

The container image has a built-in health check. If the container hangs or the script execution in the container is affected, the container status changes from "healthy" to "unhealthy". This also happens when there are problems with the ocean API. Depending on the docker configuration, you may set up actions like container restart if the container gets unhealthy.
