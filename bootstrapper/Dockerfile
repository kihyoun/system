FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
# Build from the repository root with -f bootstrapper/Dockerfile.
WORKDIR /system
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/system/bootstrapper/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/system/bootstrapper/ca/empty \
    npm_config_cafile=/system/bootstrapper/ca/cacert-2026-10-20.crt
COPY bootstrapper/ca ./bootstrapper/ca
RUN mkdir -p /system/bootstrapper/ca/empty && node /system/bootstrapper/ca/check.js --bundle
COPY operations/package.json operations/package-lock.json ./operations/
RUN npm ci --prefix operations --ignore-scripts --no-audit --no-fund
COPY operations/src ./operations/src
COPY operations/tsconfig.json ./operations/tsconfig.json
COPY gitlab/guided-preview-evidence.js gitlab/guided-preview-evidence-v1.js gitlab/job-diagnostics.js ./operations/assets/gitlab/
RUN node operations/node_modules/typescript/bin/tsc -p operations/tsconfig.json
RUN node operations/dist/host-bootstrap/entry.js install-runtime --checkout /system && node bootstrapper/ca/check.js
WORKDIR /
