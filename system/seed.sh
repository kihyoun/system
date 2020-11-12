#!/bin/bash
rsync -av --progress --delete /seed/srv/ /srv
mkdir -p /ssl
rsync -av --progress --delete /seed/ssl/ /ssl
echo 'Ready.'
exit 0
