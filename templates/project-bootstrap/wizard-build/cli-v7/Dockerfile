FROM node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5 AS checked
COPY .gitlab/cli /opt/system-bootstrapper/cli-artifact
RUN cd /opt/system-bootstrapper/cli-artifact && sha256sum -c system-bootstrapper.tgz.sha256
RUN npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock --prefix /opt/system-bootstrapper/cli /opt/system-bootstrapper/cli-artifact/system-bootstrapper.tgz
ENV PATH="/opt/system-bootstrapper/cli/node_modules/.bin:$PATH"
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /opt/system-bootstrapper/cli/node_modules/@systembootstrapper/cli
WORKDIR /app
ENV NODE_OPTIONS="--use-openssl-ca --max-old-space-size=2048"
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run lint && npm test && npm run build && npm run test:config-export
FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
# Native file replacement copies the trust store prepared by the shared service.
RUN ["rm", "-rf", "/etc/ssl/certs", "/etc/ssl/cert.pem"]
COPY --from=checked /etc/ssl/certs /etc/ssl/certs
COPY --from=checked /etc/ssl/cert.pem /etc/ssl/cert.pem
COPY --from=checked /app/build /usr/share/nginx/html
# Test-only offline adapter is outside the public web root and contains no configuration.
COPY --from=checked /app/build-tools/export-configuration.cjs /opt/system-bootstrapper/test-tools/export-configuration.cjs
COPY --from=checked /app/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
