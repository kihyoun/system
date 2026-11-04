FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /
ENV NODE_OPTIONS=--use-openssl-ca
COPY install-runtime.sh refresh-ca.sh /opt/system-bootstrapper/
COPY ca /opt/system-bootstrapper/ca
RUN sh /opt/system-bootstrapper/install-runtime.sh && node /opt/system-bootstrapper/ca/check.js
