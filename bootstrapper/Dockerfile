FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /
COPY install-runtime.sh /tmp/install-system-runtime.sh
RUN sh /tmp/install-system-runtime.sh && rm /tmp/install-system-runtime.sh
