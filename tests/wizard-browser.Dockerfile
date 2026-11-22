# Dependencies and browser installation happen only during the trusted build.
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
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY tsconfig.json LICENSE ./
COPY config ./config
COPY templates ./templates
COPY containers ./containers
RUN npm run build
RUN mkdir -p /tmp/cli-package && npm pack --offline --ignore-scripts --pack-destination /tmp/cli-package && npm install --global --offline --ignore-scripts --no-audit --no-fund /tmp/cli-package/*.tgz
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /candidate
RUN system-bootstrapper host-bootstrap ca-check --checkout /candidate
WORKDIR /candidate/wizard
COPY wizard/package.json wizard/package-lock.json ./
RUN system-bootstrapper ci node-runtime /candidate
RUN npm ci --no-audit --no-fund \
 && npx --no-install playwright install-deps chromium \
 && system-bootstrapper host-bootstrap refresh-ca --checkout /candidate \
 && system-bootstrapper host-bootstrap ca-check --checkout /candidate \
 && npx --no-install playwright install chromium
COPY .prettierrc .prettierignore /candidate/
COPY wizard/ ./
RUN npm run format:check
WORKDIR /candidate
RUN system-bootstrapper project-ci artifact-check /candidate/wizard/.gitlab/cli/system-bootstrapper.tgz
WORKDIR /candidate/wizard
# Full native suite, including its localhost build/preview server and mock APIs.
ENV CI=true \
    PLAYWRIGHT_HTML_OUTPUT_DIR=/candidate/test-results/wizard-browser/playwright-report \
    PLAYWRIGHT_JUNIT_OUTPUT_FILE=/candidate/test-results/wizard-browser/junit.xml
RUN mkdir -p /candidate/test-results/wizard-browser
CMD ["system-bootstrapper", "project-ci", "browser-suite", "/candidate/wizard", "--reporter=list,html,junit", "--output=/candidate/test-results/wizard-browser/test-results"]
