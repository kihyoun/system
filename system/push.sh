#!/bin/bash
shopt -s dotglob
mkdir -p /tmp/bootstrapper

if [ ! -f ../bootstrapper.zip ]; then
	echo 'no bootstrapper.zip found'
	exit 1
fi

[ -f ../bootstrapper.zip ] && unzip -o ../bootstrapper.zip -d /tmp/bootstrapper/
node ../project-bootstrap/preserve-system-project.js snapshot .projects.env/.wizard.env /tmp/bootstrapper-system-wizard.env
[ -d /tmp/bootstrapper ] && rsync -av --progress --delete /tmp/bootstrapper/.projects.env/ .projects.env
node ../project-bootstrap/preserve-system-project.js restore .projects.env/.wizard.env /tmp/bootstrapper-system-wizard.env
[ -d /tmp/bootstrapper ] && cp /tmp/bootstrapper/.*.env .
[ -d /tmp/bootstrapper ] && cp /tmp/bootstrapper/*.env .
[ -d /tmp/bootstrapper ] && rm -fr /tmp/bootstrapper
echo 'Ready.'
exit 0
