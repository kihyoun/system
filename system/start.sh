#! /bin/bash
set -eo pipefail
shopt -s dotglob
if [ -e /srv/gitlab/data/.system-bootstrapper-restore-incomplete ]; then
  echo 'An interrupted Seed restore must be completed before startup.' >&2
  exit 1
fi
startup_script=$PWD/seed-operation.js
if SYSTEM_STARTUP_OPERATION=$(node "$startup_script" startup-begin "$$"); then
  :
else
  startup_status=$?
  if [[ $startup_status == 75 ]]; then
    echo 'Startup paused for an unfinished operation; native recovery remains available through Docker exec.' >&2
    # Do not resume writers automatically after a lease disappears. The
    # operator finishes native recovery, then deliberately restarts this container.
    while :; do sleep 60 & wait "$!"; done
  fi
  exit "$startup_status"
fi
export SYSTEM_STARTUP_OPERATION
startup_exit() {
  result=$?
  trap - EXIT
  node "$startup_script" startup-settled "$result" || true
  exit "$result"
}
trap startup_exit EXIT
node ./persistence-init.js
node ./wizard-public.js
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
  node ../system/seed-operation.js startup-finish
  cd ../sync; bash -e ./start.sh;
  cd ../system; bash ./stop.sh
fi
