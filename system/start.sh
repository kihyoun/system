#! /bin/bash
set -eo pipefail
shopt -s dotglob
node ./persistence-init.js
source "${SYSTEM_CONFIG_DIR:-/state}/sync-auth.env"

ENV_FILE=../.docker.env
echo > $ENV_FILE
printf "export BOOTSTRAPPER_IP=" > $ENV_FILE
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_bootstrapper_1 >> $ENV_FILE

source $ENV_FILE

if [ -f .docker.env ]; then
  source .docker.env
  bash ./start-intermediate.sh
  bash ./start-main.sh

  if [ $SYNC_ENABLE = false ]; then
    cd ../system; ./wait-for-it.sh $BOOTSTRAPPER_IP:8071 -t 0
  fi

  cd ../system; bash ./stop.sh
else
  cd ../wizard; bash -e ./start.sh;
  cd ../sync; bash -e ./start.sh;
  cd ../system; bash ./stop.sh
fi
