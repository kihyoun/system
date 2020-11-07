#! /bin/bash
source ../.docker.env

docker-compose up --remove-orphans --build -d

