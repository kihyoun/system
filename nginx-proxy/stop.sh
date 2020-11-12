#! /bin/bash
for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    docker-compose -p ${PROJECT_NAME} down
done

