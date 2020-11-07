FROM ubuntu:latest
ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
RUN apt-get update
RUN apt-get upgrade -y
RUN apt-get install dialog apt-utils net-tools -y
RUN apt-get install curl npm -y
RUN bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/install.sh)"
RUN bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/prepare.sh)"
WORKDIR /system/sync
RUN npm install