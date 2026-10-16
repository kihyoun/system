#! /bin/bash
set -eo pipefail
if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env

    mkdir -p /srv/gitlab/config
    [ $GITLAB_REGISTRY_DOMAIN_MODE -lt 2 ] && DISABLE_INSECURE_REGISTRY="" || DISABLE_INSECURE_REGISTRY="#"
    cat gitlab.rb \
        | sed -e "s@\${GITLAB_REGISTRY_URL}@${GITLAB_REGISTRY_URL}@g" \
        -e "s@\${GITLAB_REGISTRY_HOST}@${GITLAB_REGISTRY_HOST}@g" \
        -e "s@\${GITLAB_EXTERNAL_URL}@${GITLAB_EXTERNAL_URL}@g" \
        -e "s@\${DISABLE_INSECURE_REGISTRY}@$DISABLE_INSECURE_REGISTRY@g" > /srv/gitlab/config/gitlab.rb

    # Configure the shared volume before GitLab's first reconfigure runs.
    docker-compose -f ../system/docker-compose.yml up --force-recreate -d gitlab
    printf "export GITLAB_IP=" > .docker.env
    docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_gitlab_1 >> .docker.env
else
    echo "gitlab [start] skipped (no main config)"
fi

