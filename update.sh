#!/bin/bash
shopt -s dotglob
cd /
[ -d system ] && [ -f bootstrapper.zip ] && unzip bootstrapper.zip -d ./tmp/
if [ -d system ]; then
        (cd system;
	[ -d /tmp/bootstrapper ] && rsync -av --progress --delete /tmp/bootstrapper/.projects.env/ .projects.env
	[ -d /tmp/bootstrapper ] && cp /tmp/bootstrapper/.*.env .
	[ -d /tmp/bootstrapper ] && cp /tmp/bootstrapper/*.env .
	[ -d /tmp/bootstrapper ] && rm -fr /tmp/bootstrapper
	)
	echo 'Ready.'
	exit 0
else
        echo "System not found."
		exit 1
fi
