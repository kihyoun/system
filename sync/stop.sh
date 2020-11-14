#! /bin/bash
source ../system/.seed.env
source ../.docker.env
source ../wizard/.docker.env
docker-compose -f ../system/docker-compose.yml stop sync
