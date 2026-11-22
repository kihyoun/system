ARG IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime-build
WORKDIR /system
COPY config/ca ./config/ca
COPY src/common/caPolicy.mts ./src/common/caPolicy.mts
COPY src/cli/verifyCa.mts ./src/cli/verifyCa.mts
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/system/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/system/config/ca/empty \
    npm_config_cafile=/system/config/ca/cacert-2026-10-20.crt
RUN echo '796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe  config/ca/cacert-2026-10-20.crt' | sha256sum -c -
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY tsconfig.json LICENSE ./
COPY config ./config
COPY templates ./templates
COPY containers ./containers
RUN npm run build
RUN npm link --global --offline --ignore-scripts --no-audit --no-fund

FROM runtime-build AS configuration-export
COPY config ./config
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /system
WORKDIR /wizard
COPY wizard/package.json wizard/package-lock.json ./
RUN npm ci
COPY wizard/src ./src
COPY wizard/scripts/export-configuration.ts ./scripts/export-configuration.ts
RUN npm run build:config-export

FROM $IMAGE
ENV NODE_OPTIONS=--use-openssl-ca
ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /system
COPY . .
COPY --from=runtime-build /system/dist ./dist
COPY --from=runtime-build /system/node_modules ./node_modules
COPY --from=runtime-build /system/assets/public-runtime.json ./assets/public-runtime.json
COPY --from=configuration-export /wizard/build-tools/export-configuration.cjs /opt/system-bootstrapper/export-configuration.cjs
COPY assets/cli-companion /opt/system-bootstrapper/cli-artifact
ENV SYSTEM_CLI_ARTIFACT=/opt/system-bootstrapper/cli-artifact/system-bootstrapper.tgz
RUN npm link --global --offline --ignore-scripts --no-audit --no-fund
RUN system-bootstrapper host-bootstrap install-runtime --checkout /system
RUN system-bootstrapper ci image-compatibility /system
RUN system-bootstrapper source-prepare /system --verify
CMD ["system-bootstrapper", "lifecycle", "start", "/system"]
