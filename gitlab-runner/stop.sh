#! /bin/bash
source ../.docker.env

for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
do
    docker run --rm --volumes-from gitlab-runner_docker_$i \
        gitlab/gitlab-runner unregister --name docker-$i \
        --url ${GITLAB_EXTERNAL_URL}
done

docker-compose down

