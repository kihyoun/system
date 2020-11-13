#! /bin/bash
if [ -f system/.docker.env ]; then
    source system/.docker.env
else
    source system/.docker.env.example
    source system/.seed.env
fi

docker-compose -f system/docker-compose.yml up --build --force-recreate -d bootstrapper
