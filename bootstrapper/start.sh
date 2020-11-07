#! /bin/bash
source ../.docker.env

docker-compose up --build --force-recreate -d
