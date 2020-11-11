#! /bin/bash
source .docker.env
rsync -av --delete /ssl /seed/ssl
rsync -av --delete /srv /seed/srv
