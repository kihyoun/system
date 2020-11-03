#! /bin/bash
source ../.docker.env
source ../gitlab/.docker.env

export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE

for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
do
    docker run --rm --volumes-from ${PROJECT_NAME}_runner_docker_$i \
        --network=container:${PROJECT_NAME}_runner_docker_$i \
        gitlab/gitlab-runner unregister --name ${PROJECT_NAME}-runner-docker-$i \
        --url ${GITLAB_EXTERNAL_URL} --all-runners
done

docker-compose -p ${PROJECT_NAME}_runner down

for i in $(find ../.projects.env ../projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE

    for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
    do
        docker run --rm --volumes-from ${PROJECT_NAME}_runner_docker_$i \
            --network=container:${PROJECT_NAME}_runner_docker_$i \
            gitlab/gitlab-runner unregister --name ${PROJECT_NAME}-runner-docker-$i \
            --url ${GITLAB_EXTERNAL_URL} --all-runners
    done

    docker-compose -p ${PROJECT_NAME}_runner down
done

docker volume prune -f
docker network prune -f
