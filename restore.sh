#!/bin/bash
shopt -s dotglob
(cd /;
[ -d system ] && [ -f bootstrapper.zip ] && unzip bootstrapper.zip -d ./system/
if [ -d system ]; then
        (cd system;
	[ -d bootstrapper ] && cp bootstrapper/.projects.env/* .projects.env/
	[ -d bootstrapper ] && cp bootstrapper/* .
	[ -d bootstrapper ] && rm -fr bootstrapper
	if [ -f .docker.env ]; then
		source .docker.env
		rsync -av --progress $BACKUPDIR/srv/ /srv
		mkdir -p /ssl
		rsync -av --progress $BACKUPDIR/ssl/ /ssl
	fi
	)
	echo 'Ready.'
	exit 0
else
        echo "System not found."
		exit 1
fi
)