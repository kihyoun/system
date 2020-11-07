#! /bin/bash

if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    export LIVEDIR=/srv
    export SSL_BASEDIR=/etc/letsencrypt
    [ -z $BACKUPDIR ] && export BACKUPDIR=/mnt/backup
    [ ! -z $BACKUPDIR ] && export BACKUPDIR=$BACKUPDIR
fi

docker-compose up --build --force-recreate -d
