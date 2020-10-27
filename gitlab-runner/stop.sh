#! /bin/bash
source ../.docker.env

for i in ../.projects.env/.*.env; do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE

    for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
    do
        docker run --rm --volumes-from ${PROJECT_NAME}_runner_docker_$i \
            --network=contaier:${PROJECT_NAME}_runner_docker_$i \
            gitlab/gitlab-runner unregister --name ${PROJECT_NAME}-runner-docker-$i \
            --url ${GITLAB_EXTERNAL_URL}
    done

    docker-compose -p ${PROJECT_NAME}_runner down
done
