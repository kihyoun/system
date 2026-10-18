#! /bin/bash
set -eo pipefail
source ./pool.sh
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    if [ $# -lt 1 ] || [ "$1" = main ]; then
        runner_pool up runner
    fi

    if [ $# -lt 1 ] || [ "$1" = projects ]; then
        while IFS= read -r -d '' config; do
            source "$config"
            if [ "${PROJECT_TEMPLATE:-}" = wizard ] && [ "$PROJECT_NAME" = wizard ]; then continue; fi
            runner_pool up "${PROJECT_NAME}_runner"
        done < <(find -H ../system/.projects.env ../system/projects.env -type f -name '*.env' -print0 2>/dev/null)
    fi

    bash register.sh "$@"
else
    echo '[start] Skipped.'
fi
