# Isolated checks only: no Docker daemon, live credentials or private configuration.
FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
WORKDIR /candidate
COPY config/ca ./config/ca
COPY src/common/ca-policy.mts ./src/common/ca-policy.mts
COPY src/cli/verify-ca.mts ./src/cli/verify-ca.mts
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/candidate/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/candidate/config/ca/empty \
    npm_config_cafile=/candidate/config/ca/cacert-2026-10-20.crt
RUN node src/cli/verify-ca.mts --bundle
RUN node --version && npm --version && git --version && ldd /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends python3 rsync unzip zip openssl \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build
RUN node dist/cli/main.js ci image-compatibility /candidate
RUN node dist/cli/main.js host-bootstrap refresh-ca --checkout /candidate
RUN node dist/cli/main.js host-bootstrap ca-check --checkout /candidate
RUN node dist/cli/main.js source-prepare /candidate --verify
ENV SYSTEM_TEST_ISOLATED=1
ENTRYPOINT ["node", "tests/run.js"]
CMD ["all"]
