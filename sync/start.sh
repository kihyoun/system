#! /bin/bash

if [ -f .docker.env ]; then
  npm start
else
  source ../system/.seed.env
  source ../.docker.env
  source ../wizard/.docker.env

  cat ../nginx/.templates/default.sync.template | sed -e "s@\${PROXY_UPSTREAM}@sync@g" \
    -e "s@\${PROXY_IP}@$BOOTSTRAPPER_IP@g" \
    -e "s@\${PROXY_PORT}@8071@g" \
    -e "s@\${PROXY_HOSTNAME}@$BOOTSTRAPPER_IP@g" > /synctemplates/default.conf.template

  cat ../nginx/.templates/default.conf.template | sed -e "s@\${PROXY_UPSTREAM}@wizard@g" \
    -e "s@\${PROXY_IP}@$WIZARD_IP@g" \
    -e "s@\${PROXY_PORT}@80@g" \
    -e "s@\${PROXY_HOSTNAME}@$WIZARD_IP@g" >> /synctemplates/default.conf.template

  docker-compose up --build --remove-orphans --force-recreate -d sync
  npm start
  docker-compose stop sync
fi
