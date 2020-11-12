#! /bin/bash
source ../system/.docker.env
source ../gitlab/.docker.env
export GITLAB_HOST=$GITLAB_HOST
export GITLAB_REGISTRY_HOST=$GITLAB_REGISTRY_HOST
export GITLAB_IP=$GITLAB_IP

docker-compose -p runner up --build --remove-orphans -d

for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE
    export GITLAB_HOST=$GITLAB_HOST
    export GITLAB_REGISTRY_HOST=$GITLAB_REGISTRY_HOST
    export GITLAB_IP=$GITLAB_IP
    docker-compose -p ${PROJECT_NAME}_runner up --build --remove-orphans -d
done
