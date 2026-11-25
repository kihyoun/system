FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5 AS tooling
WORKDIR /runtime
COPY source/config/ca ./config/ca
COPY source/src/common/caPolicy.mts ./src/common/caPolicy.mts
COPY source/src/cli/verifyCa.mts ./src/cli/verifyCa.mts
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/runtime/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/runtime/config/ca/empty \
    npm_config_cafile=/runtime/config/ca/cacert-2026-10-20.crt
RUN echo '796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe  config/ca/cacert-2026-10-20.crt' | sha256sum -c -
COPY source/package.json source/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY source/src ./src
COPY source/tsconfig.json source/LICENSE ./
COPY tooling/config ./config
COPY tooling/templates ./templates
COPY tooling/containers ./containers
RUN npm run build

FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
WORKDIR /runtime
COPY --from=tooling /runtime ./
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/runtime/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/runtime/config/ca/empty \
    CURL_CA_BUNDLE=/runtime/config/ca/cacert-2026-10-20.crt \
    SYSTEM_CODEQL_IMAGE_BUILD=1
RUN npm link --offline --ignore-scripts --no-audit --no-fund
RUN system-bootstrapper ci codeql-toolchain /runtime
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /runtime
RUN system-bootstrapper host-bootstrap ca-check --checkout /runtime
COPY source /source
ENV HOME=/reports/home
USER node
WORKDIR /source
ENTRYPOINT ["system-bootstrapper", "ci", "codeql", "/source", "/reports"]
