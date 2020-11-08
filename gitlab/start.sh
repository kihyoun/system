#! /bin/bash
source ../.docker.env

docker-compose -f ../system/docker-compose.yml up --build --remove-orphans -d gitlab

printf "export GITLAB_IP=" > .docker.env
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_gitlab_1 >> .docker.env
source .docker.env
mkdir -p /srv/gitlab/config
cat gitlab.rb \
    | sed -e "s@\${GITLAB_REGISTRY_URL}@${GITLAB_REGISTRY_URL}@g" \
    -e "s@\${GITLAB_REGISTRY_HOST}@${GITLAB_REGISTRY_HOST}@g" \
    -e "s@\${GITLAB_EXTERNAL_URL}@${GITLAB_EXTERNAL_URL}@g" \
    -e "s@\${GITLAB_REGISTRY_PORT}@${GITLAB_REGISTRY_PORT}@g" \
    -e "s@\${GITLAB_IP}@${GITLAB_IP}@g" > /srv/gitlab/config/gitlab.rb

docker restart system_gitlab_1


