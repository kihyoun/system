FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5 AS node-runtime
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY .gitlab/cli /opt/system-bootstrapper/cli-artifact
RUN cd /opt/system-bootstrapper/cli-artifact && sha256sum -c system-bootstrapper.tgz.sha256
RUN npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock --prefix /opt/system-bootstrapper/cli /opt/system-bootstrapper/cli-artifact/system-bootstrapper.tgz
ENV PATH="/opt/system-bootstrapper/cli/node_modules/.bin:$PATH"
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /opt/system-bootstrapper/cli/node_modules/@systembootstrapper/cli
WORKDIR /smoke
ENV NODE_OPTIONS=--use-openssl-ca
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY .system-bootstrapper/build-v3/browser/package.json .system-bootstrapper/build-v3/browser/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
CMD ["system-bootstrapper", "project-ci", "browser-smoke", "/smoke"]
