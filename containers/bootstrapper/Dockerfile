FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
# Build from the repository root with -f containers/bootstrapper/Dockerfile.
WORKDIR /system
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/system/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/system/config/ca/empty \
    npm_config_cafile=/system/config/ca/cacert-2026-10-20.crt
COPY config/ca ./config/ca
COPY src/common/ca-policy.mts ./src/common/ca-policy.mts
COPY src/cli/verify-ca.mts ./src/cli/verify-ca.mts
RUN node src/cli/verify-ca.mts --bundle
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY tsconfig.json LICENSE ./
COPY config ./config
COPY templates ./templates
COPY containers ./containers
COPY wizard/.gitlab/runtime ./wizard/.gitlab/runtime
RUN npm run build
RUN node dist/cli/main.js ci image-compatibility /system
RUN node dist/cli/main.js host-bootstrap install-runtime --checkout /system
RUN node dist/cli/main.js host-bootstrap ca-check --checkout /system
WORKDIR /
