#!/usr/bin/env bash
set -eo pipefail

if [ ! -f ../system/.docker.env ] || [ ! -f ../gitlab/.docker.env ]; then
    echo "gitlab-runner [register] skipped. No main config."
    exit 0
fi
source ../system/.docker.env
source ../gitlab/.docker.env

register_runner() {
    local container="$1" name="$2"
    if [ -z "${GITLAB_RUNNER_TOKEN:-}" ] || [ "$GITLAB_RUNNER_TOKEN" = secret-token ]; then
        echo "Runner $name needs a runner token; registration skipped."
        return 0
    fi
    if docker exec "$container" grep -q '^\[\[runners\]\]' /etc/gitlab-runner/config.toml 2>/dev/null; then
        docker exec "$container" gitlab-runner verify
        return
    fi

    local ready=false
    for attempt in $(seq 1 90); do
        if docker exec system_gitlab_1 curl -fsS --max-time 3 http://127.0.0.1/-/readiness >/dev/null 2>&1; then
            ready=true
            break
        fi
        sleep 2
    done
    if [ "$ready" != true ]; then
        echo "GitLab did not become ready for runner registration." >&2
        return 1
    fi

    local token_args=()
    if [[ "$GITLAB_RUNNER_TOKEN" == glrt-* ]]; then
        token_args=(--token "$GITLAB_RUNNER_TOKEN")
    else
        token_args=(--registration-token "$GITLAB_RUNNER_TOKEN"
            --tag-list "docker,aws" --run-untagged=true --access-level=not_protected)
    fi
    docker exec "$container" gitlab-runner register --non-interactive \
        --executor docker --docker-image alpine:3.22 \
        --url "http://$GITLAB_IP/" "${token_args[@]}" \
        --description "$name" --clone-url "http://$GITLAB_IP/" \
        --docker-network-mode system_gitlab \
        --docker-extra-hosts "$GITLAB_HOST:host-gateway" \
        --docker-extra-hosts "$GITLAB_REGISTRY_HOST:host-gateway" \
        --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
        --docker-privileged=true
}

if [ $# -lt 1 ] || [ "$1" = main ]; then
    for i in $(seq 1 "$GITLAB_RUNNER_SCALE"); do
        register_runner "runner_docker_$i" "runner-docker-$i"
    done
fi

if [ $# -lt 1 ] || [ "$1" = projects ]; then
    for config in ../system/.projects.env/*.env ../system/.projects.env/.*.env ../system/projects.env/*.env; do
        [ -f "$config" ] || continue
        source "$config"
        for i in $(seq 1 "$GITLAB_RUNNER_SCALE"); do
            register_runner "${PROJECT_NAME}_runner_docker_$i" "$PROJECT_NAME-runner-docker-$i"
        done
    done
fi
