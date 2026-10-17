#! /bin/bash
set -eo pipefail
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    if ! [[ "$GITLAB_RUNNER_SCALE" =~ ^([0-9]|[1-4][0-9]|50)$ ]]; then
        echo 'Runner count must be an integer from 0 to 50.' >&2
        exit 1
    fi

    if [ $# -lt 1 ] || [ "$1" = "main" ]; then
        docker-compose -p runner up --build --scale docker=$GITLAB_RUNNER_SCALE --remove-orphans -d
    fi

    if [ $# -lt 1 ] || [ "$1" = "projects" ]; then
        for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
            source $i
            docker-compose -p ${PROJECT_NAME}_runner up --build --scale docker=$GITLAB_RUNNER_SCALE --remove-orphans -d
        done
    fi

    bash register.sh $1
else
    echo "[start] Skipped."
fi
