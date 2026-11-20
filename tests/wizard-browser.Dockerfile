# Dependencies and browser installation happen only during the trusted build.
FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
COPY bootstrapper/ca/cacert-2026-10-20.crt bootstrapper/ca/provenance.json bootstrapper/ca/check.js /candidate/bootstrapper/ca/
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/candidate/bootstrapper/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/candidate/bootstrapper/ca/empty \
    npm_config_cafile=/candidate/bootstrapper/ca/cacert-2026-10-20.crt
WORKDIR /candidate
RUN mkdir -p /candidate/bootstrapper/ca/empty && node /candidate/bootstrapper/ca/check.js --bundle
COPY operations/package.json operations/package-lock.json ./operations/
RUN npm ci --prefix operations --ignore-scripts --no-audit --no-fund
COPY operations/src ./operations/src
COPY operations/tsconfig.json ./operations/tsconfig.json
COPY operations/scripts/bundle-project-ci.mjs ./operations/scripts/bundle-project-ci.mjs
COPY LICENSE ./LICENSE
RUN node operations/node_modules/typescript/bin/tsc -p operations/tsconfig.json
RUN node operations/dist/host-bootstrap/entry.js refresh-ca --checkout /candidate && node bootstrapper/ca/check.js
WORKDIR /candidate/wizard
COPY wizard/package.json wizard/package-lock.json ./
RUN test "$(node --version)" = v24.22.0 && test "$(npm --version)" = 11.19.1 \
 && npm ci --no-audit --no-fund \
 && npx --no-install playwright install-deps chromium \
 && node /candidate/operations/dist/host-bootstrap/entry.js refresh-ca --checkout /candidate && node /candidate/bootstrapper/ca/check.js \
 && npx --no-install playwright install chromium
COPY .prettierrc .prettierignore /candidate/
COPY wizard/ ./
RUN npm run format:check && node /candidate/operations/scripts/bundle-project-ci.mjs --check
# Full native suite, including its localhost build/preview server and mock APIs.
ENV CI=true \
    PLAYWRIGHT_HTML_OUTPUT_DIR=/candidate/test-results/wizard-browser/playwright-report \
    PLAYWRIGHT_JUNIT_OUTPUT_FILE=/candidate/test-results/wizard-browser/junit.xml
RUN mkdir -p /candidate/test-results/wizard-browser
CMD ["npm", "run", "test:ci", "--", "--reporter=list,html,junit", "--output=/candidate/test-results/wizard-browser/test-results"]
