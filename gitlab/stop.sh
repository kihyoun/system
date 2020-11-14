#! /bin/bash
if [ -f ../system/.docker.env ]; then
    source ../system/.docker.env
    docker-compose -f ../system/docker-compose.yml stop gitlab
else
    echo "gitlab [stop] skipped (no main config)"
fi


