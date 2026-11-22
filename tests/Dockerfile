# Isolated checks only: no Docker daemon, live credentials or private configuration.
FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
WORKDIR /candidate
COPY config/ca ./config/ca
COPY src/common/caPolicy.mts ./src/common/caPolicy.mts
COPY src/cli/verifyCa.mts ./src/cli/verifyCa.mts
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/candidate/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/candidate/config/ca/empty \
    npm_config_cafile=/candidate/config/ca/cacert-2026-10-20.crt
RUN echo '796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe  config/ca/cacert-2026-10-20.crt' | sha256sum -c -
RUN node --version && npm --version && git --version && ldd /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends python3 rsync unzip zip openssl \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm link --global --offline --ignore-scripts --no-audit --no-fund
ENV SYSTEM_CLI_ARTIFACT=/candidate/assets/cli-companion/system-bootstrapper.tgz
RUN system-bootstrapper ci image-compatibility /candidate
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /candidate
RUN system-bootstrapper host-bootstrap ca-check --checkout /candidate
RUN system-bootstrapper source-prepare /candidate --verify
ENV SYSTEM_TEST_ISOLATED=1
ENTRYPOINT ["node", "tests/run.js"]
CMD ["all"]
