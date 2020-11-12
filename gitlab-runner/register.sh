#! /bin/bash
source ../system/.docker.env
source ../gitlab/.docker.env
export GITLAB_HOST=$GITLAB_HOST
export GITLAB_REGISTRY_HOST=$GITLAB_REGISTRY_HOST
export GITLAB_IP=$GITLAB_IP

for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
do
    docker run --rm --network=container:runner_docker_$i \
    --volumes-from=runner_docker_$i gitlab/gitlab-runner register \
    --non-interactive \
    --executor "docker" \
    --docker-image alpine:latest \
    --url "http://$GITLAB_IP:$GITLAB_PORT/" \
    --registration-token "$GITLAB_RUNNER_TOKEN" \
    --description "runner-docker-$i" \
    --tag-list "docker,aws" \
    --run-untagged=true \
    --access-level="not_protected" \
    --clone-url "http://$GITLAB_IP:$GITLAB_PORT/" \
    --docker-network-mode="system_gitlab" \
    --docker-volumes "/var/run/docker.sock:/var/run/docker.sock" \
    --docker-privileged=true
done

for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE
    export GITLAB_HOST=$GITLAB_HOST
    export GITLAB_REGISTRY_HOST=$GITLAB_REGISTRY_HOST
    export GITLAB_IP=$GITLAB_IP

    for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
    do
        docker run --rm --network=container:${PROJECT_NAME}_runner_docker_$i \
        --volumes-from=${PROJECT_NAME}_runner_docker_$i gitlab/gitlab-runner register \
        --non-interactive \
        --executor "docker" \
        --docker-image alpine:latest \
        --url "http://$GITLAB_IP:$GITLAB_PORT/" \
        --registration-token "$GITLAB_RUNNER_TOKEN" \
        --description "$PROJECT_NAME-runner-docker-$i" \
        --tag-list "docker,aws" \
        --run-untagged=true \
        --access-level="not_protected" \
        --clone-url "http://$GITLAB_IP:$GITLAB_PORT/" \
        --docker-network-mode="system_gitlab" \
        --docker-volumes "/var/run/docker.sock:/var/run/docker.sock" \
        --docker-privileged=true
    done

done
