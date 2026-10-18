#! /bin/bash
set -eo pipefail
if [ -e /srv/gitlab/data/.system-bootstrapper-restore-incomplete ]; then
    echo 'An interrupted Seed restore must be completed before GitLab startup.' >&2
    exit 1
fi
if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env

    mkdir -p /srv/gitlab/config
    GITLAB_INITIAL_ROOT_PASSWORD="${GITLAB_INITIAL_ROOT_PASSWORD:-}" node ./prepare-root-password.js
    [ $GITLAB_REGISTRY_DOMAIN_MODE -lt 2 ] && DISABLE_INSECURE_REGISTRY="" || DISABLE_INSECURE_REGISTRY="#"
    next_config=$(mktemp /srv/gitlab/config/.gitlab.rb.XXXXXX)
    trap 'rm -f -- "$next_config"' EXIT
    cat gitlab.rb \
        | sed -e "s@\${GITLAB_REGISTRY_URL}@${GITLAB_REGISTRY_URL}@g" \
        -e "s@\${GITLAB_REGISTRY_HOST}@${GITLAB_REGISTRY_HOST}@g" \
        -e "s@\${GITLAB_EXTERNAL_URL}@${GITLAB_EXTERNAL_URL}@g" \
        -e "s@\${DISABLE_INSECURE_REGISTRY}@$DISABLE_INSECURE_REGISTRY@g" > "$next_config"

    recreate=()
    if ! cmp -s "$next_config" /srv/gitlab/config/gitlab.rb; then
        mv "$next_config" /srv/gitlab/config/gitlab.rb
        recreate=(--force-recreate)
    fi

    # Configure the shared volume before GitLab's first reconfigure runs.
    docker-compose -f ../system/docker-compose.yml up "${recreate[@]}" -d gitlab
    printf "export GITLAB_IP=" > .docker.env
    docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' system_gitlab_1 >> .docker.env
else
    echo "gitlab [start] skipped (no main config)"
fi

