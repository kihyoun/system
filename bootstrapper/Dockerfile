FROM ubuntu:latest
ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
RUN apt-get update
RUN apt-get upgrade -y
RUN apt-get install dialog apt-utils net-tools vim rsync iputils-ping -y
RUN apt-get install curl npm -y
COPY install.sh /tmp/install.sh
RUN bash /tmp/install.sh