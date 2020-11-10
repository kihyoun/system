#! /bin/bash
if [ -f .docker.env ]; then
    source .docker.env
else
    source .docker.env.example
    export REVIEW_SCALE=0
    export PROD_SCALE=0
    export BETA_SCALE=0
    export SSL_BASEDIR=/etc/letsencrypt
    [ -z $BACKUPDIR ] && export BACKUPDIR=/mnt/backup
    [ ! -z $BACKUPDIR ] && export BACKUPDIR=$BACKUPDIR
fi

(cd gitlab-runner; bash stop.sh)
(cd nginx-proxy; bash stop.sh)
(cd gitlab; bash stop.sh)
(cd nginx; bash stop.sh)
