#! /bin/bash
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    source ../system/seed.env
fi

source ../gitlab/.docker.env
source ../system/.docker.env

docker-compose -f ../system/docker-compose.yml stop web
