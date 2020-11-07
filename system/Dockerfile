FROM bootstrapper_system
ARG DEBIAN_FRONTEND=noninteractive
ARG LIVEDIR
# Checkout fresh Repo, prepare
WORKDIR $LIVEDIR
RUN bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/prepare.sh)"
# Install Sync Server
WORKDIR $LIVEDIR/system/sync
RUN npm install
# Start
WORKDIR $LIVEDIR/system
CMD ["/bin/bash", "./start.sh"]