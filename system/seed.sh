#! /bin/bash
(cd ../bootstrapper; bash start.sh)
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    source ../.docker.env.example
    source seed.env
fi

docker-compose up --build --force-recreate -d bootstrapper
