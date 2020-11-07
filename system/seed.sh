#! /bin/bash
(cd ../bootstrapper; bash start.sh)
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    export LIVEDIR=/srv
    export SSL_BASEDIR=/etc/letsencrypt
    [ -z $BACKUPDIR ] && export BACKUPDIR=/mnt/backup
    [ ! -z $BACKUPDIR ] && export BACKUPDIR=$BACKUPDIR
fi

docker-compose up --build --force-recreate -d bootstrapper

ENV_FILE=.docker.env
echo > $ENV_FILE
printf "BOOTSTRAPPER_IP=" > $ENV_FILE
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_bootstrapper_1 >> $ENV_FILE
