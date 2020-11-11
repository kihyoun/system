#! /bin/bash
for i in $(find ../.projects.env ../projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    docker-compose -p ${PROJECT_NAME} down
done

