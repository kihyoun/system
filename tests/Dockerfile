# Isolated checks only: no Docker daemon, live credentials or private configuration.
FROM node:24.22.0-bookworm@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS node-runtime
FROM ruby:3.4.11-bookworm@sha256:80259ba83f866aaa43c689e11569dc950b2e508effca0799d50608f7c4ca6172
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
COPY sync/package.json sync/package-lock.json ./sync/
RUN cd sync && npm ci --ignore-scripts --no-audit --no-fund
COPY sync/src ./sync/src
COPY sync/tsconfig.json ./sync/tsconfig.json
COPY sync/eslint.config.mjs ./sync/eslint.config.mjs
COPY project-bootstrap ./project-bootstrap
COPY gitlab/*.js gitlab/*.sh gitlab/*.rb gitlab/*.json ./gitlab/
COPY gitlab-runner/*.js gitlab-runner/*.sh gitlab-runner/*.rb gitlab-runner/docker-compose.yml ./gitlab-runner/
COPY nginx/*.sh ./nginx/
COPY nginx/.templates ./nginx/.templates
COPY nginx-proxy/*.sh ./nginx-proxy/
COPY start.sh ./
COPY sync/start.sh ./sync/
COPY system/ ./system/
COPY bootstrapper/ ./bootstrapper/
COPY tests ./tests
COPY .gitlab-ci.yml ./
RUN node project-bootstrap/wizard-source/package.js --verify \
 && cd sync && npm run build
ENV SYSTEM_TEST_ISOLATED=1
ENTRYPOINT ["node", "tests/run.js"]
CMD ["all"]
