FROM docker:latest
ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
RUN apk add dialog net-tools vim rsync iputils
RUN apk add curl npm
RUN apk add docker-compose
RUN docker-compose --version
