#########################################################################
#                                                                       #
#     Author:              RoMi1981                                     #
#     Github:              https://github.com/RoMi1981                  #
#                                                                       #
#     Website Vault-Maxi:  https://www.vault-maxi.live                  #
#     Github Vault-Maxi:   https://github.com/kuegi/defichain_maxi      #
#                                                                       #
#########################################################################

FROM node:alpine3.17 AS build
LABEL stage=build

ARG VAULT_MAXI_VERSION=tags/v2.5.1
ARG VAULT_MAXI_REPO_URL=https://github.com/kuegi/defichain_maxi.git

RUN apk add git \
   && git clone ${VAULT_MAXI_REPO_URL} /build

WORKDIR /build

RUN git checkout ${VAULT_MAXI_VERSION}

WORKDIR /build/ocean-client

RUN npm i \
   && npm audit fix \
   && npm run build-app


FROM node:alpine3.17

LABEL author="RoMi1981 - https://github.com/RoMi1981"
LABEL website="https://www.vault-maxi.live"
LABEL github="https://github.com/kuegi/defichain_maxi"

RUN apk update && apk upgrade \
   && apk add bash openssl coreutils findutils \
   && rm -rf /var/cache/apk/*

COPY start.sh /root/
COPY healthcheck.sh /root/

COPY --from=build /build/ocean-client/dist.app /root/app

WORKDIR /root/

HEALTHCHECK --start-period=10s CMD bash healthcheck.sh || exit 1

ENTRYPOINT ["/bin/bash", "/root/start.sh"]
