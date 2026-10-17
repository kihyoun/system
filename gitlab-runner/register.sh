#!/usr/bin/env bash
set -eo pipefail
exec 9>/tmp/system-bootstrapper-runner-registration.lock
flock -n 9 || { echo 'Runner registration already in progress.' >&2; exit 1; }

if [ ! -f ../system/.docker.env ] || [ ! -f ../gitlab/.docker.env ]; then
    echo "gitlab-runner [register] skipped. No main config."
    exit 0
fi
source ../system/.docker.env
source ../gitlab/.docker.env

# One instance runner with multiple managers. Scaling does not create duplicate
# GitLab runner records. Project runners keep their explicitly supplied token.
if { [ $# -lt 1 ] || [ "$1" = main ]; } && [ "$GITLAB_RUNNER_SCALE" -gt 0 ]; then
    for attempt in $(seq 1 180); do
        if docker exec system_gitlab_1 curl -fsS --max-time 3 http://127.0.0.1/-/readiness >/dev/null 2>&1; then
            break
        fi
        if [ "$attempt" -eq 180 ]; then
            echo "GitLab did not become ready for runner setup." >&2
            exit 1
        fi
        sleep 2
    done
    GITLAB_RUNNER_TOKEN="${GITLAB_RUNNER_TOKEN:-}" node provision.js
    source ../system/.docker.env
fi

register_runner() {
    local container="$1" name="$2"
    if [ -z "${GITLAB_RUNNER_TOKEN:-}" ] || [ "$GITLAB_RUNNER_TOKEN" = secret-token ]; then
        echo "Runner $name needs a runner token; registration skipped."
        return 0
    fi
    if docker exec "$container" grep -q '^\[\[runners\]\]' /etc/gitlab-runner/config.toml 2>/dev/null; then
        node refresh-endpoint.js "$container"
        docker exec "$container" gitlab-runner verify >/dev/null 2>&1 || {
            echo "Runner $name verification failed; check its configured token." >&2
            return 1
        }
        echo "Runner $name verified."
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

    local token_variable=CI_SERVER_TOKEN extra_args=()
    if [[ "$GITLAB_RUNNER_TOKEN" == glrt-* ]]; then
        token_variable=CI_SERVER_TOKEN
    else
        token_variable=REGISTRATION_TOKEN
        extra_args=(--tag-list "docker,aws" --run-untagged=true --access-level=not_protected)
    fi
    # Keep credentials out of process arguments and captured API output.
    printf '%s' "$GITLAB_RUNNER_TOKEN" | docker exec -i "$container" sh -c \
        'variable=$1; shift; export "$variable=$(cat)"; exec gitlab-runner register "$@"' \
        sh "$token_variable" --non-interactive "${extra_args[@]}" \
        --executor docker --docker-image alpine:3.22 \
        --url "http://gitlab/" \
        --description "$name" --clone-url "http://gitlab/" \
        --docker-network-mode system_gitlab \
        --docker-extra-hosts "$GITLAB_HOST:host-gateway" \
        --docker-extra-hosts "$GITLAB_REGISTRY_HOST:host-gateway" \
        --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
        --docker-privileged=true >/dev/null 2>&1 || {
            echo "Runner $name registration failed." >&2
            return 1
        }
    echo "Runner $name registered."
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
        if [ "${PROJECT_TEMPLATE:-}" = wizard ] && [ "$PROJECT_NAME" = wizard ]; then continue; fi
        for i in $(seq 1 "$GITLAB_RUNNER_SCALE"); do
            register_runner "${PROJECT_NAME}_runner_docker_$i" "$PROJECT_NAME-runner-docker-$i"
        done
    done
fi
