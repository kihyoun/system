ARG IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
FROM $IMAGE

ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
COPY . /system
RUN sh /system/bootstrapper/install-runtime.sh
RUN node /system/project-bootstrap/wizard-source/package.js --verify
# Install Sync Server
WORKDIR /system/sync
RUN npm ci && npm run build
# Start
WORKDIR /system/system
CMD ["/bin/bash", "./start.sh"]
