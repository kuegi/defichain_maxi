FROM node:alpine3.17 AS build
LABEL stage=build

ARG VAULT_MAXI_VERSION=v2.5.0
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

RUN apk add bash openssl

COPY start.sh /root/

COPY --from=build /build/ocean-client/dist.app /root/app

WORKDIR /root/

ENTRYPOINT ["/bin/bash", "/root/start.sh"]
