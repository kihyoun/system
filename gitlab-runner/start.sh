#! /bin/bash
source ../.docker.env
source ../gitlab/.docker.env

echo > ./.hosts

[ $GITLAB_DOMAIN_MODE -lt 2 ] && echo "${GITLAB_IP} ${GITLAB_HOST}" >> ./.hosts
[ $GITLAB_REGISTRY_DOMAIN_MODE -lt 2 ] && echo "${GITLAB_IP} ${GITLAB_REGISTRY_HOST}" >> ./.hosts

for i in ../.projects.env/.*.env; do
    source $i
    export GITLAB_RUNNER_DOCKER_SCALE=$GITLAB_RUNNER_DOCKER_SCALE

    docker-compose -p ${PROJECT_NAME}_runner up --build --remove-orphans -d

    for i in $( seq 1 $GITLAB_RUNNER_DOCKER_SCALE )
    do
        docker run --rm --network=container:${PROJECT_NAME}_runner_docker_$i \
        --volumes-from=${PROJECT_NAME}_runner_docker_$i gitlab/gitlab-runner register \
        --non-interactive \
        --executor "docker" \
        --docker-image alpine:latest \
        --url $([ $GITLAB_DOMAIN_MODE -lt 2 ] && echo "http://$GITLAB_IP:$GITLAB_PORT/" || echo "${GITLAB_EXTERNAL_URL}") \
        --registration-token "$GITLAB_RUNNER_TOKEN" \
        --description "$PROJECT_NAME-runner-docker-$i" \
        --tag-list "docker,aws" \
        --run-untagged=true \
        --access-level="not_protected" \
        --docker-network-mode="gitlab_web" \
        --clone-url $([ $GITLAB_DOMAIN_MODE -lt 2 ] && echo "http://$GITLAB_IP:$GITLAB_PORT/" || echo "${GITLAB_EXTERNAL_URL}") \
        --docker-volumes "/var/run/docker.sock:/var/run/docker.sock" \
        $([ $GITLAB_DOMAIN_MODE -lt 2 ] && echo '--docker-volumes /etc/hosts:/etc/hosts') \
        --docker-privileged=true
    done

done
