# Isolated checks only: no Docker daemon, live credentials or private configuration.
FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5
RUN node --version && npm --version && git --version \
 && ldd /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends python3 rsync unzip zip openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /candidate
COPY bootstrapper/ca ./bootstrapper/ca
ENV NODE_OPTIONS=--use-openssl-ca \
    SSL_CERT_FILE=/candidate/bootstrapper/ca/cacert-2026-10-20.crt \
    SSL_CERT_DIR=/candidate/bootstrapper/ca/empty \
    npm_config_cafile=/candidate/bootstrapper/ca/cacert-2026-10-20.crt
RUN mkdir -p /candidate/bootstrapper/ca/empty && node /candidate/bootstrapper/ca/check.js --bundle
COPY sync/package.json sync/package-lock.json ./sync/
RUN cd sync && npm ci --ignore-scripts --no-audit --no-fund
COPY sync/src ./sync/src
COPY sync/tsconfig.json ./sync/tsconfig.json
COPY sync/eslint.config.mjs ./sync/eslint.config.mjs
COPY operations/package.json operations/package-lock.json ./operations/
RUN cd operations && npm ci --ignore-scripts --no-audit --no-fund
COPY operations/src ./operations/src
COPY operations/tests ./operations/tests
COPY operations/tsconfig.json ./operations/tsconfig.json
COPY operations/README.md ./operations/README.md
COPY operations/scripts ./operations/scripts
COPY gitlab/guided-preview-evidence.js gitlab/guided-preview-evidence-v1.js gitlab/job-diagnostics.js ./gitlab/
COPY LICENSE .prettierrc .prettierignore ./
COPY project-bootstrap ./project-bootstrap
COPY wizard ./wizard
RUN cd operations && npm run build
RUN node operations/dist/host-bootstrap/entry.js refresh-ca --checkout /candidate && node bootstrapper/ca/check.js
COPY gitlab/*.js gitlab/*.rb gitlab/*.json gitlab/docker-compose.omnibus.yml ./gitlab/
COPY gitlab/renovate ./gitlab/renovate
COPY renovate.json ./
COPY gitlab-runner/*.js gitlab-runner/docker-compose.yml ./gitlab-runner/
COPY nginx/*.js ./nginx/
COPY nginx/.templates ./nginx/.templates
COPY nginx-proxy/ ./nginx-proxy/
COPY system/ ./system/
COPY bootstrapper/ ./bootstrapper/
COPY tools/ ./tools/
COPY tests ./tests
COPY docs ./docs
COPY Prepare-Host.md overview.png ./
COPY gitlab-runner/README.md ./gitlab-runner/README.md
COPY .gitlab-ci.yml ./
COPY VERSION ./
RUN node project-bootstrap/wizard-source/package.js --verify \
 && cd sync && npm run build
ENV SYSTEM_TEST_ISOLATED=1
ENTRYPOINT ["node", "tests/run.js"]
CMD ["all"]
