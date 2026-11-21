FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5 AS tooling
WORKDIR /runtime
COPY source/config/ca ./config/ca
COPY source/src/common/ca-policy.mts ./src/common/ca-policy.mts
COPY source/src/cli/verify-ca.mts ./src/cli/verify-ca.mts
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/runtime/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/runtime/config/ca/empty \
    npm_config_cafile=/runtime/config/ca/cacert-2026-10-20.crt
RUN node src/cli/verify-ca.mts --bundle
COPY source/package.json source/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY source/src ./src
COPY source/tsconfig.json source/LICENSE ./
COPY tooling/config ./config
COPY tooling/templates ./templates
COPY tooling/containers ./containers
COPY tooling/wizard/.gitlab/runtime ./wizard/.gitlab/runtime
RUN npm run build

FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
WORKDIR /runtime
COPY --from=tooling /runtime ./
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/runtime/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/runtime/config/ca/empty \
    CURL_CA_BUNDLE=/runtime/config/ca/cacert-2026-10-20.crt \
    SYSTEM_CODEQL_IMAGE_BUILD=1
RUN node dist/cli/main.js ci codeql-toolchain /runtime
RUN node dist/cli/main.js host-bootstrap refresh-ca --checkout /runtime
RUN node dist/cli/main.js host-bootstrap ca-check --checkout /runtime
COPY source /source
ENV HOME=/reports/home
USER node
WORKDIR /source
ENTRYPOINT ["node", "/runtime/dist/cli/main.js", "ci", "codeql", "/source", "/reports"]
