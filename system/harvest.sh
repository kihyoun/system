#! /bin/bash
rsync -av --delete /ssl/ /seed/ssl
rsync -av --delete /srv/ /seed/srv
