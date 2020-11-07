FROM bootstrapper_system
ARG DEBIAN_FRONTEND=noninteractive
# Checkout fresh Repo, prepare
WORKDIR /
RUN bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/prepare.sh)"
# Install Sync Server
WORKDIR /system/sync
RUN npm install
# Start
WORKDIR /system
CMD ["/bin/bash", "./start.sh"]