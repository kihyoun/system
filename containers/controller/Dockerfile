ARG IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime-build
WORKDIR /system
COPY config/ca ./config/ca
COPY src/common/ca-policy.mts ./src/common/ca-policy.mts
COPY src/cli/verify-ca.mts ./src/cli/verify-ca.mts
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/system/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/system/config/ca/empty \
    npm_config_cafile=/system/config/ca/cacert-2026-10-20.crt
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

FROM runtime-build AS configuration-export
COPY config ./config
RUN node dist/cli/main.js host-bootstrap refresh-ca --checkout /system
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
RUN node dist/cli/main.js host-bootstrap install-runtime --checkout /system
RUN node dist/cli/main.js ci image-compatibility /system
RUN node dist/cli/main.js source-prepare /system --verify
CMD ["system-bootstrapper", "lifecycle", "start", "/system"]
