#! /bin/bash
if [ -f ../system/.docker.env ] && [ -f ../gitlab/.docker.env ]; then
    source ../system/.docker.env
    source ../gitlab/.docker.env

    if [ $# -lt 1 ] || [ "$1" = "main" ]; then
        docker-compose -p runner up --build --remove-orphans -d
    fi

    if [ $# -lt 1 ] || [ "$1" = "projects" ]; then
        for i in $(find ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
            source $i
            docker-compose -p ${PROJECT_NAME}_runner up --build --remove-orphans -d
        done
    fi

    bash register.sh $1
else
    echo "[start] Skipped."
fi