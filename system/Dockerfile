ARG IMAGE=systembootstrapper/system
FROM $IMAGE

ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /
COPY . /system
# Install Sync Server
WORKDIR /system/sync
RUN npm install
# Start
WORKDIR /system/system
CMD ["/bin/bash", "./start.sh"]