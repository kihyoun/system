#! /bin/bash
[ ! -f ../.docker.env ] && exit
source ../.docker.env
docker-compose -f ../system/docker-compose.yml stop gitlab

