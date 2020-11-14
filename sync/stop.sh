#! /bin/bash

if [ ! -f ../system/.docker.env ]; then
  source ../system/.seed.env
  source ../.docker.env
  source ../wizard/.docker.env
  docker-compose -f ../system/docker-compose.yml stop sync
fi
