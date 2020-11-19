FROM docker:latest
ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
RUN apk update
RUN apk upgrade
RUN apk add dialog net-tools vim rsync iputils
RUN apk add curl npm zsh unzip git ca-certificates curl
RUN curl -L "https://github.com/docker/compose/releases/download/1.27.4/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
RUN chmod +x /usr/local/bin/docker-compose
RUN ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose