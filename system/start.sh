#! /bin/bash
shopt -s dotglob

ENV_FILE=../.docker.env
echo > $ENV_FILE
printf "export BOOTSTRAPPER_IP=" > $ENV_FILE
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_bootstrapper_1 >> $ENV_FILE

source $ENV_FILE

if [ -f .docker.env ]; then
  bash ./start-intermediate.sh
  bash ./start-main.sh
  [ $SYNC_ENABLE = false ] && cd ../system; ./wait-for-it.sh $BOOTSTRAPPER_IP:8071 -t 0
  cd ../system; bash ./stop.sh
else
  cd ../wizard; bash ./start.sh;
  cd ../sync; bash ./start.sh;
  cd ../system; bash ./stop.sh
fi
