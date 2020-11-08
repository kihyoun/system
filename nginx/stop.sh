#! /bin/bash
source ../.docker.env
source ../gitlab/.docker.env
source ../system/.docker.env

docker-compose -f ../system/docker-compose.yml stop web
