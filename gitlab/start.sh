#! /bin/bash
source ../.docker.env

docker-compose up --build --remove-orphans -d

printf "GITLAB_IP=" > .docker.env
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' gitlab_gitlab_1 >> .docker.env
source .docker.env
cat gitlab.rb \
    | sed -e "s@\${GITLAB_REGISTRY_URL}@${GITLAB_REGISTRY_URL}@g" \
    -e "s@\${GITLAB_REGISTRY_HOST}@${GITLAB_REGISTRY_HOST}@g" \
    -e "s@\${GITLAB_EXTERNAL_URL}@${GITLAB_EXTERNAL_URL}@g" \
    -e "s@\${GITLAB_REGISTRY_PORT}@${GITLAB_REGISTRY_PORT}@g" \
    -e "s@\${GITLAB_IP}@${GITLAB_IP}@g" > $GITLAB_HOME/config/gitlab.rb

docker restart gitlab_gitlab_1


