#! /bin/bash
shopt -s dotglob

ENV_FILE=system/.docker.env
echo > $ENV_FILE
printf "export BOOTSTRAPPER_IP=" > $ENV_FILE
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_bootstrapper_1 >> $ENV_FILE


while [ true ]; do
  source $ENV_FILE
  if [ -f .docker.env ]; then
    source .docker.env
    (cd gitlab; bash ./start.sh)
    (cd nginx-proxy; bash ./start.sh)
    (cd nginx; bash ./start.sh)
    [ $SYNC_ENABLE = true ] && (cd sync; bash ./start.sh)
    [ $SYNC_ENABLE = false ] && ./wait-for-it.sh $BOOTSTRAPPER_IP:8071 -t 0
    bash ./stop.sh
  else
    echo "No .docker.env found. Starting synchronisation server..."
    cat ../nginx/.templates/default.conf.template| sed -e "s@\${PROXY_UPSTREAM}@sync@g" \
      -e "s@\${PROXY_IP}@$BOOTSTRAPPER_IP@g" \
      -e "s@\${PROXY_PORT}@8071@g" \
      -e "s@\${PROXY_HOSTNAME}@$BOOTSTRAPPER_IP@g" > /synctemplates/default.conf.template

    docker-compose -f system/docker-compose.yml up --build --remove-orphans --force-recreate -d sync
    (cd sync; bash ./start.sh)
    docker-compose -f system/docker-compose.yml down sync
  fi

done