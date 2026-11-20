#! /bin/bash

if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env

    if [ $WIZARD_ENABLE = true ]; then
        docker-compose -f ../system/docker-compose.yml stop wizard
    fi
else
    docker-compose -f ../system/docker-compose.yml stop wizard
fi