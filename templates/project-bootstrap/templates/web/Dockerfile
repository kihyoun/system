FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
COPY .gitlab/cli /opt/system-bootstrapper/cli-artifact
RUN cd /opt/system-bootstrapper/cli-artifact && sha256sum -c system-bootstrapper.tgz.sha256
RUN npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock --prefix /opt/system-bootstrapper/cli /opt/system-bootstrapper/cli-artifact/system-bootstrapper.tgz
ENV PATH="/opt/system-bootstrapper/cli/node_modules/.bin:$PATH"
RUN system-bootstrapper host-bootstrap refresh-ca --checkout /opt/system-bootstrapper/cli/node_modules/@systembootstrapper/cli
FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
RUN ["rm", "-rf", "/etc/ssl/certs", "/etc/ssl/cert.pem"]
COPY --from=build /etc/ssl/certs /etc/ssl/certs
COPY --from=build /etc/ssl/cert.pem /etc/ssl/cert.pem

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html main.js styles.css /usr/share/nginx/html/
EXPOSE 80
