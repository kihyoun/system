FROM bootstrapper_system
ARG DEBIAN_FRONTEND=noninteractive
# Checkout fresh Repo
WORKDIR /
COPY checkout.sh /tmp/checkout.sh
RUN bash -c /tmp/checkout.sh
# Install Sync Server
WORKDIR /system/sync
RUN npm install
# Start
WORKDIR /system/system
CMD ["/bin/bash", "./start.sh"]