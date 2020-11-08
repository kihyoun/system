#! /bin/bash
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    source ../system/seed.env
fi

docker-compose -f ../system/docker-compose.yml stop gitlab

