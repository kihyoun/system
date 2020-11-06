#!/bin/bash
shopt -s dotglob
[ -d system ] && [ -f bootstrapper.zip ] && unzip bootstrapper.zip -d ./system/
if [ -d system ]; then
        (cd system;
	[ -d bootstrapper ] && cp bootstrapper/.projects.env/* .projects.env/
	[ -d bootstrapper ] && cp bootstrapper/* .
	[ -d bootstrapper ] && rm -fr bootstrapper
	if [ -f .docker.env ]; then
		source .docker.env
		rsync -av --progress $BACKUPDIR/srv/ $LIVEDIR
		mkdir -p /etc/letsencrypt
		rsync -av --progress $BACKUPDIR/letsencrypt/ /etc/letsencrypt
		./start.sh
	fi
	)
	echo 'Ready.'
else
        echo "System not found."
fi
