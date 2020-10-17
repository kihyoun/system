#! /bin/bash
source ../.docker.env
export GITLAB_HOME=$GITLAB_HOME
export GITLAB_HOSTNAME=$GITLAB_HOSTNAME
docker-compose down