#!/bin/bash
shopt -s dotglob
mkdir -p /tmp/bootstrapper

if [ ! -f ../bootstrapper.zip ]; then
	echo 'no bootstrapper.zip found'
	exit 1
fi

[ -f ../bootstrapper.zip ] && unzip -o ../bootstrapper.zip -d ./tmp/bootstrapper/
[ -d /tmp/bootstrapper ] && rsync -av --progress --delete /tmp/bootstrapper/.projects.env/ .projects.env
[ -d /tmp/bootstrapper ] && cp /tmp/bootstrapper/.*.env .
[ -d /tmp/bootstrapper ] && cp /tmp/bootstrapper/*.env .
[ -d /tmp/bootstrapper ] && rm -fr /tmp/bootstrapper
echo 'Ready.'
exit 0
