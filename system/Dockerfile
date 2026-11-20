ARG IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS operations-build
WORKDIR /system
COPY bootstrapper/ca ./bootstrapper/ca
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/system/bootstrapper/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/system/bootstrapper/ca/empty \
    npm_config_cafile=/system/bootstrapper/ca/cacert-2026-10-20.crt
RUN mkdir -p /system/bootstrapper/ca/empty && node /system/bootstrapper/ca/check.js --bundle
COPY operations/package.json operations/package-lock.json ./operations/
RUN npm ci --prefix operations --ignore-scripts --no-audit --no-fund
COPY operations/src ./operations/src
COPY operations/tsconfig.json ./operations/tsconfig.json
COPY gitlab/guided-preview-evidence.js gitlab/guided-preview-evidence-v1.js gitlab/job-diagnostics.js ./operations/assets/gitlab/
RUN node operations/node_modules/typescript/bin/tsc -p operations/tsconfig.json

FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS configuration-export
ENV NODE_OPTIONS=--use-openssl-ca
COPY --from=operations-build /system/operations /system/operations
COPY bootstrapper/ca /system/bootstrapper/ca
RUN node /system/operations/dist/host-bootstrap/entry.js refresh-ca --checkout /system
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
COPY --from=operations-build /system/operations /system/operations
RUN node /system/operations/dist/host-bootstrap/entry.js install-runtime --checkout /system
RUN node /system/project-bootstrap/wizard-source/package.js --verify
# Shared CLI and recovery services are prepared before maintenance begins.
# Install Sync Server
WORKDIR /system/sync
RUN npm ci && npm run build
# Start
WORKDIR /system/system
CMD ["node", "/system/operations/dist/lifecycle/entry.js", "start", "/system"]
