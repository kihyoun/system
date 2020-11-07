FROM system_system
ARG DEBIAN_FRONTEND=noninteractive
ARG LIVEDIR=/srv
WORKDIR $LIVEDIR
RUN bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/prepare.sh)"
WORKDIR $LIVEDIR/system/sync
RUN npm install
CMD ["/bin/bash", "./start.sh"]