#l! /bin/bash

if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env

    if [ $WIZARD_ENABLE = true ]; then
        docker-compose -f ../system/docker-compose.yml up --remove-orphans --build -d wizard
    fi
else
    docker-compose -f ../system/docker-compose.yml up --remove-orphans --build -d wizard
fi

echo > .docker.env
printf "WIZARD_IP=" > .docker.env
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_wizard_1 >> .docker.env
