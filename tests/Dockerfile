# Isolated checks only: no Docker daemon, live credentials or private configuration.
FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5 AS node-runtime
FROM ruby:3.4.11-bookworm@sha256:1aed73d35b66ce974febaefe42e8385abb8cbf6244ea4f45b266be9178acfd37
# Both official runtime stages use Debian Bookworm/glibc. Ruby's full image
# already includes Git and the shared libraries required by the Node binary.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && node --version && npm --version && ruby --version && git --version \
 && ldd /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends python3 rsync unzip zip openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /candidate
COPY bootstrapper/refresh-ca.sh ./bootstrapper/
COPY bootstrapper/ca ./bootstrapper/ca
ENV NODE_OPTIONS=--use-openssl-ca
RUN sh bootstrapper/refresh-ca.sh && node bootstrapper/ca/check.js
COPY sync/package.json sync/package-lock.json ./sync/
RUN cd sync && npm ci --ignore-scripts --no-audit --no-fund
COPY sync/src ./sync/src
COPY sync/tsconfig.json ./sync/tsconfig.json
COPY sync/eslint.config.mjs ./sync/eslint.config.mjs
COPY project-bootstrap ./project-bootstrap
COPY gitlab/*.js gitlab/*.sh gitlab/*.rb gitlab/*.json gitlab/docker-compose.omnibus.yml ./gitlab/
COPY gitlab/renovate ./gitlab/renovate
COPY renovate.json ./
COPY gitlab-runner/*.js gitlab-runner/*.sh gitlab-runner/*.rb gitlab-runner/docker-compose.yml ./gitlab-runner/
COPY nginx/*.sh nginx/*.js ./nginx/
COPY nginx/.templates ./nginx/.templates
COPY nginx-proxy/*.sh ./nginx-proxy/
COPY start.sh ./
COPY sync/start.sh ./sync/
COPY system/ ./system/
COPY bootstrapper/ ./bootstrapper/
COPY tests ./tests
COPY docs/check-wizard-docs.js ./docs/check-wizard-docs.js
COPY .gitlab-ci.yml ./
COPY VERSION ./
RUN node project-bootstrap/wizard-source/package.js --verify \
 && cd sync && npm run build
ENV SYSTEM_TEST_ISOLATED=1
ENTRYPOINT ["node", "tests/run.js"]
CMD ["all"]
