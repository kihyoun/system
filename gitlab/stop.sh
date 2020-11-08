#! /bin/bash
source ../.docker.env
docker-compose -f ../system/docker-compose.yml stop gitlab

