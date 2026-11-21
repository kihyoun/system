FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
COPY .system-bootstrapper/runtime /opt/system-bootstrapper/runtime
COPY .system-bootstrapper/bootstrapper/ca /opt/system-bootstrapper/bootstrapper/ca
RUN node /opt/system-bootstrapper/runtime/project-ci.cjs refresh-ca /opt/system-bootstrapper
FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
RUN ["rm", "-rf", "/etc/ssl/certs", "/etc/ssl/cert.pem"]
COPY --from=build /etc/ssl/certs /etc/ssl/certs
COPY --from=build /etc/ssl/cert.pem /etc/ssl/cert.pem

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html main.js styles.css /usr/share/nginx/html/
EXPOSE 80
