#! /bin/bash
npm start

cat ../nginx/.templates/default.conf.template| sed -e "s@\${PROXY_UPSTREAM}@sync@g" \
      -e "s@\${PROXY_IP}@$BOOTSTRAPPER_IP@g" \
      -e "s@\${PROXY_PORT}@8071@g" \
      -e "s@\${PROXY_HOSTNAME}@$BOOTSTRAPPER_IP@g" > /synctemplates/default.conf.template

docker-compose -f ../system/docker-compose.yml up --build --remove-orphans --force-recreate -d sync
