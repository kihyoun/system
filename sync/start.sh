#! /bin/bash

if [ -f ../system/.docker.env ]; then
  npm start
else
  source ../system/.seed.env
  source ../.docker.env
  source ../wizard/.docker.env

  cat ../nginx/.templates/default.sync.template | sed -e "s@\${SYNC_IP}@$BOOTSTRAPPER_IP@g" \
    -e "s@\${WIZARD_IP}@$WIZARD_IP@g" \
    > /synctemplates/default.conf.template

  docker-compose -f ../system/docker-compose.yml up --build --remove-orphans --force-recreate -d sync
  npm start
  docker-compose -f ../system/docker-compose.yml stop sync
fi
