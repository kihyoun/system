#! /bin/bash

if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    if [ $# -lt 1 ] || [ "$1" = "main" ]; then
        for i in $( seq 1 $GITLAB_RUNNER_SCALE ); do
            docker run --rm --volumes-from runner_docker_$i \
                --network=container:runner_docker_$i \
                gitlab/gitlab-runner unregister --name runner-docker-$i \
                --url ${GITLAB_EXTERNAL_URL} --all-runners
        done
    fi

    if [ $# -lt 1 ] || [ "$1" = "projects" ]; then
        for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
            source $i

            for i in $( seq 1 $GITLAB_RUNNER_SCALE ); do
                docker run --rm --volumes-from ${PROJECT_NAME}_runner_docker_$i \
                    --network=container:${PROJECT_NAME}_runner_docker_$i \
                    gitlab/gitlab-runner unregister --name ${PROJECT_NAME}-runner-docker-$i \
                    --url ${GITLAB_EXTERNAL_URL} --all-runners
            done
        done
    fi
else
    echo "gitlab-runner [unregister] skipped (no main config)"
fi