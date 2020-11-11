#!/bin/bash
shopt -s dotglob
if [ -f .docker.env ]; then
	source .docker.env
	rsync -av --progress --delete /seed/srv/ /srv
	mkdir -p /ssl
	rsync -av --progress --delete /seed/ssl/ /ssl
else
	echo "Seed canceled. No .docker.env"
	exit 1
fi
echo 'Ready.'
exit 0
