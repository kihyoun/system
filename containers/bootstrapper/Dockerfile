FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
# Build from the repository root with -f containers/bootstrapper/Dockerfile.
WORKDIR /system
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/system/config/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/system/config/ca/empty \
    npm_config_cafile=/system/config/ca/cacert-2026-10-20.crt
COPY config/ca ./config/ca
COPY src/common/caPolicy.mts ./src/common/caPolicy.mts
COPY src/cli/verifyCa.mts ./src/cli/verifyCa.mts
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
RUN system-bootstrapper ci image-compatibility /system
RUN system-bootstrapper host-bootstrap install-runtime --checkout /system
RUN system-bootstrapper host-bootstrap ca-check --checkout /system
WORKDIR /
