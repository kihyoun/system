#! /bin/bash
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env
    docker-compose -f ../system/docker-compose.yml stop web
else
    echo "nginx [stop] no main config found. Trying to stop..."
    source ../system/.seed.env
    source ../.docker.env
    docker-compose -f ../system/docker-compose.yml stop web
fi

