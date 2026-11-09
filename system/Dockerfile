ARG IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS configuration-export
ENV NODE_OPTIONS=--use-openssl-ca
COPY bootstrapper/refresh-ca.sh /system/bootstrapper/refresh-ca.sh
COPY bootstrapper/ca /system/bootstrapper/ca
RUN sh /system/bootstrapper/refresh-ca.sh
WORKDIR /wizard
COPY wizard/package.json wizard/package-lock.json ./
RUN npm ci
COPY wizard/src ./src
COPY wizard/scripts/export-configuration.ts ./scripts/export-configuration.ts
RUN npm run build:config-export

FROM $IMAGE
ENV NODE_OPTIONS=--use-openssl-ca

ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
COPY . /system
COPY --from=configuration-export /wizard/build-tools/export-configuration.cjs /opt/system-bootstrapper/export-configuration.cjs
RUN sh /system/bootstrapper/install-runtime.sh
RUN node /system/project-bootstrap/wizard-source/package.js --verify
# Install Sync Server
WORKDIR /system/sync
RUN npm ci && npm run build
# Start
WORKDIR /system/system
CMD ["/bin/bash", "./start.sh"]
