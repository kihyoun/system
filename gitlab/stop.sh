#! /bin/bash
[ -f ../.docker.env ] && source ../.docker.env
docker-compose -f ../system/docker-compose.yml stop gitlab

