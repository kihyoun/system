#!/bin/bash
bash update.sh
shopt -s dotglob
cd /;
if [ -d system ]; then
        cd system;
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
else
        echo "System not found."
		exit 1
fi
