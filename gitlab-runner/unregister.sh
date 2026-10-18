#! /bin/bash
set -eo pipefail

unregister_runner() {
    local container="$1"
    if ! docker exec "$container" gitlab-runner unregister --all-runners >/dev/null 2>&1; then
        echo "Runner $container could not be unregistered." >&2
        return 1
    fi
    echo "Runner $container unregistered."
}

if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    if [ $# -lt 1 ] || [ "$1" = "main" ]; then
        for i in $( seq 1 $GITLAB_RUNNER_SCALE ); do
            unregister_runner "runner_docker_$i"
        done
    fi

    if [ $# -lt 1 ] || [ "$1" = "projects" ]; then
        while IFS= read -r -d '' config; do
            source "$config"
            if [ "${PROJECT_TEMPLATE:-}" = wizard ] && [ "$PROJECT_NAME" = wizard ]; then continue; fi

            for i in $( seq 1 $GITLAB_RUNNER_SCALE ); do
                unregister_runner "${PROJECT_NAME}_runner_docker_$i"
            done
        done < <(find -H ../system/.projects.env ../system/projects.env -type f -name '*.env' -print0 2>/dev/null)
    fi
else
    echo "gitlab-runner [unregister] skipped (no main config)"
fi
