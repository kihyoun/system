#! /bin/bash
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    bash unregister.sh $1

    if [ $# -lt 1 ] || [ "$1" = "main" ]; then
        docker-compose -p runner down
    fi

    if [ $# -lt 1 ] || [ "$1" = "projects" ]; then
        for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
            source $i
            if [ "${PROJECT_TEMPLATE:-}" = wizard ] && [ "$PROJECT_NAME" = wizard ]; then continue; fi
            docker-compose -p ${PROJECT_NAME}_runner down
        done
    fi
else
    echo "gitlab-runner [stop] skipped (no main config)"
fi

