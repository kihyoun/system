#! /bin/bash
source .docker.env
rsync -av --delete /ssl $BACKUPDIR
rsync -av --delete /srv $BACKUPDIR
