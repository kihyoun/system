#!/bin/bash
shopt -s dotglob
if [ -f .docker.env ]; then
	source .docker.env
	rsync -av --progress --delete $BACKUPDIR/srv/ /srv
	mkdir -p /ssl
	rsync -av --progress --delete $BACKUPDIR/ssl/ /ssl
else
	echo "Restore failed. No .docker.env"
	exit 1
fi
echo 'Ready.'
exit 0
