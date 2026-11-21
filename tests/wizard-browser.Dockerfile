# Dependencies and browser installation happen only during the trusted build.
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
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY tsconfig.json LICENSE ./
COPY config ./config
COPY templates ./templates
COPY containers ./containers
COPY wizard/.gitlab/runtime ./wizard/.gitlab/runtime
RUN npm run build
RUN node dist/cli/main.js host-bootstrap refresh-ca --checkout /candidate
RUN node dist/cli/main.js host-bootstrap ca-check --checkout /candidate
WORKDIR /candidate/wizard
COPY wizard/package.json wizard/package-lock.json ./
RUN node /candidate/dist/cli/main.js ci node-runtime /candidate
RUN npm ci --no-audit --no-fund \
 && npx --no-install playwright install-deps chromium \
 && node /candidate/dist/cli/main.js host-bootstrap refresh-ca --checkout /candidate \
 && node /candidate/dist/cli/main.js host-bootstrap ca-check --checkout /candidate \
 && npx --no-install playwright install chromium
COPY .prettierrc .prettierignore /candidate/
COPY wizard/ ./
RUN npm run format:check
WORKDIR /candidate
RUN node dist/cli/main.js bundle-project-ci --check
WORKDIR /candidate/wizard
# Full native suite, including its localhost build/preview server and mock APIs.
ENV CI=true \
    PLAYWRIGHT_HTML_OUTPUT_DIR=/candidate/test-results/wizard-browser/playwright-report \
    PLAYWRIGHT_JUNIT_OUTPUT_FILE=/candidate/test-results/wizard-browser/junit.xml
RUN mkdir -p /candidate/test-results/wizard-browser
CMD ["npm", "run", "test:ci", "--", "--reporter=list,html,junit", "--output=/candidate/test-results/wizard-browser/test-results"]
