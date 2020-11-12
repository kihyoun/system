#! /bin/bash
if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env
else
    source ../system/.docker.env.example
    source ../system/.seed.env
fi
[ -f ../gitlab/.docker.env ] && source ../gitlab/.docker.env
[ -f ../system/.docker.env ] && source ../system/.docker.env

docker-compose -f ../system/docker-compose.yml stop web
