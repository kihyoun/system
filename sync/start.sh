#! /bin/bash

if [ -f ../system/.docker.env ]; then
  source ../system/.docker.env
  [ $SYNC_ENABLE = true ] && npm start
else
  # The controller already receives the real host seed path from Compose.
  bootstrapper_seed_set=${SEED_DIR+x}
  bootstrapper_seed_dir=${SEED_DIR-}
  source ../system/.seed.env
  if [[ $bootstrapper_seed_set ]]; then export SEED_DIR=$bootstrapper_seed_dir; fi
  unset bootstrapper_seed_set bootstrapper_seed_dir
  source ../.docker.env
  source ../wizard/.docker.env

  cat ../nginx/.templates/default.sync.template | sed -e "s@\${SYNC_IP}@$BOOTSTRAPPER_IP@g" \
    -e "s@\${WIZARD_IP}@$WIZARD_IP@g" \
    > /synctemplates/default.conf.template

  docker-compose -f ../system/docker-compose.yml up --build --remove-orphans --force-recreate -d sync
  npm start
fi
