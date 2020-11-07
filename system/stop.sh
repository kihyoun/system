#! /bin/bash
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    export LIVEDIR=/srv
    export BACKUPDIR=/backup
    export SSL_BASEDIR=/etc/letsencrypt
fi

docker-compose down