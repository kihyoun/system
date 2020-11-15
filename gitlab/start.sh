#! /bin/bash
if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env

    docker-compose -f ../system/docker-compose.yml up --build --remove-orphans -d gitlab

    printf "export GITLAB_IP=" > .docker.env
    docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_gitlab_1 >> .docker.env
    source .docker.env
    mkdir -p /srv/gitlab/config
    [ $GITLAB_REGISTRY_DOMAIN_MODE < 2 ] && DISABLE_INSECURE_REGISTRY="" || DISABLE_INSECURE_REGISTRY="#"
    cat gitlab.rb \
        | sed -e "s@\${GITLAB_REGISTRY_URL}@${GITLAB_REGISTRY_URL}@g" \
        -e "s@\${GITLAB_REGISTRY_HOST}@${GITLAB_REGISTRY_HOST}@g" \
        -e "s@\${GITLAB_EXTERNAL_URL}@${GITLAB_EXTERNAL_URL}@g" \
        -e "s@\${DISABLE_INSECURE_REGISTRY}@$DISABLE_INSECURE_REGISTRY@g" \
        -e "s@\${GITLAB_IP}@${GITLAB_IP}@g" > /srv/gitlab/config/gitlab.rb

    docker restart system_gitlab_1
else
    echo "gitlab [start] skipped (no main config)"
fi

