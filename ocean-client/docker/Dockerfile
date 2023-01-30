FROM node:alpine3.17 AS build
COPY . /build
WORKDIR /build
RUN npm i \
   && npm audit fix \
   && npm run build-app

FROM node:alpine3.17
WORKDIR /app
COPY --from=build /build/dist.app /app
