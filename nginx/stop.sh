#! /bin/bash
source ../.docker.env

export NGINX_TEMPLATE_DIR=$NGINX_TEMPLATE_DIR
export NGINX_HOST=$NGINX_HOST
export NGINX_PORT=$NGINX_PORT
docker-compose down