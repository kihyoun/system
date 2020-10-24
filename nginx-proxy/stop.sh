#! /bin/bash
for i in ../.projects.env/.*.env; do
    source $i
    docker-compose -p ${PROJECT_NAME} down
done

