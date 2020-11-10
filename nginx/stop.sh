#! /bin/bash
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    source ../system/seed.env
fi
[ -f ../gitlab/.docker.env ] && source ../gitlab/.docker.env
[ -f ../system/.docker.env ] && source ../system/.docker.env

docker-compose -f ../system/docker-compose.yml stop web
