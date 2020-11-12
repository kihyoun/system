#! /bin/bash
if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env
else
    source ../system/.docker.env.example
    source ../system/.seed.env
fi

[ -f ../gitlab/.docker.env ] && source ../gitlab/.docker.env

export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE
docker-compose -p runner down

for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE
    docker-compose -p ${PROJECT_NAME}_runner down
done

