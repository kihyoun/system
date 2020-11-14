#! /bin/bash
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    if [ $# -lt 1 ] || [ "$1" = "main" ]; then
        for i in $( seq 1 $GITLAB_RUNNER_SCALE ); do
            docker run --rm --network=container:runner_docker_$i \
                --volumes-from=runner_docker_$i gitlab/gitlab-runner register \
                --non-interactive \
                --executor "docker" \
                --docker-image alpine:latest \
                --url "http://$GITLAB_IP:80/" \
                --registration-token "$GITLAB_RUNNER_TOKEN" \
                --description "runner-docker-$i" \
                --tag-list "docker,aws" \
                --run-untagged=true \
                --access-level="not_protected" \
                --clone-url "http://$GITLAB_IP:80/" \
                --docker-network-mode="system_gitlab" \
                --docker-volumes "/var/run/docker.sock:/var/run/docker.sock" \
                --docker-privileged=true
        done
    fi

    if [ $# -lt 1 ] || [ "$1" = "projects" ]; then
        for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
            source $i

            for i in $( seq 1 $GITLAB_RUNNER_SCALE ); do
                docker run --rm --network=container:${PROJECT_NAME}_runner_docker_$i \
                    --volumes-from=${PROJECT_NAME}_runner_docker_$i gitlab/gitlab-runner register \
                    --non-interactive \
                    --executor "docker" \
                    --docker-image alpine:latest \
                    --url "http://$GITLAB_IP:80/" \
                    --registration-token "$GITLAB_RUNNER_TOKEN" \
                    --description "$PROJECT_NAME-runner-docker-$i" \
                    --tag-list "docker,aws" \
                    --run-untagged=true \
                    --access-level="not_protected" \
                    --clone-url "http://$GITLAB_IP:80/" \
                    --docker-network-mode="system_gitlab" \
                    --docker-volumes "/var/run/docker.sock:/var/run/docker.sock" \
                    --docker-privileged=true
            done
        done
    fi
else
    echo "gitlab-runner [register] skipped. No main config."
fi