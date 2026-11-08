# Dependencies and browser installation happen only during the trusted build.
FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
COPY bootstrapper/refresh-ca.sh /candidate/bootstrapper/
COPY bootstrapper/ca/cacert-2026-10-20.crt bootstrapper/ca/provenance.json bootstrapper/ca/check.js /candidate/bootstrapper/ca/
ENV NODE_OPTIONS=--use-openssl-ca
RUN sh /candidate/bootstrapper/refresh-ca.sh && node /candidate/bootstrapper/ca/check.js
WORKDIR /candidate/wizard
COPY wizard/package.json wizard/package-lock.json ./
RUN test "$(node --version)" = v24.22.0 && test "$(npm --version)" = 11.19.1 \
 && npm ci --no-audit --no-fund \
 && npx --no-install playwright install-deps chromium \
 && sh /candidate/bootstrapper/refresh-ca.sh && node /candidate/bootstrapper/ca/check.js \
 && npx --no-install playwright install chromium
COPY wizard/ ./
# Full native suite, including its localhost build/preview server and mock APIs.
ENV CI=true \
    PLAYWRIGHT_HTML_OUTPUT_DIR=/candidate/test-results/wizard-browser/playwright-report \
    PLAYWRIGHT_JUNIT_OUTPUT_FILE=/candidate/test-results/wizard-browser/junit.xml
RUN mkdir -p /candidate/test-results/wizard-browser
CMD ["npm", "run", "test:ci", "--", "--reporter=list,html,junit", "--output=/candidate/test-results/wizard-browser/test-results"]
