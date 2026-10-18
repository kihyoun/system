#! /bin/bash
set -eo pipefail
source ./pool.sh
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    # Keep manager registration and config for restart. Explicit unregister.sh
    # remains available when intentionally removing registration.
    if [ $# -lt 1 ] || [ "$1" = main ]; then
        runner_pool down runner
    fi

    if [ $# -lt 1 ] || [ "$1" = projects ]; then
        while IFS= read -r -d '' config; do
            source "$config"
            if [ "${PROJECT_TEMPLATE:-}" = wizard ] && [ "$PROJECT_NAME" = wizard ]; then continue; fi
            runner_pool down "${PROJECT_NAME}_runner"
        done < <(find -H ../system/.projects.env ../system/projects.env -type f -name '*.env' -print0 2>/dev/null)
    fi
else
    echo 'gitlab-runner [stop] skipped (no main config)'
fi
