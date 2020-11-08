#! /bin/bash
source .docker.env
rsync -av --delete /etc/letsencrypt $BACKUPDIR
rsync -av --delete /srv $BACKUPDIR
