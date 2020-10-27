#! /bin/bash
source ../.docker.env
source ../gitlab/.docker.env
echo ${GITLAB_IP} ${GITLAB_HOST} > .hosts

for i in ../.projects.env/.*.env; do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE
    docker-compose -p ${PROJECT_NAME}_runner up --build --remove-orphans -d

    for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
    do
        docker run --rm --volumes-from ${PROJECT_NAME}_runner_docker_$i gitlab/gitlab-runner register \
        --non-interactive \
        --executor "docker" \
        --docker-image alpine:latest \
        --url "$GITLAB_EXTERNAL_URL/" \
        --registration-token "$GITLAB_RUNNER_TOKEN" \
        --description "$PROJECT_NAME-runner-docker-$i" \
        --tag-list "docker,aws" \
        --run-untagged=true \
        --locked=false \
        --access-level="not_protected" \
        --docker-volumes "/var/run/docker.sock:/var/run/docker.sock" \
        --docker-privileged=true
    done

done
