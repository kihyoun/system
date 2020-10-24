#! /bin/bash
echo > .docker.env
for i in ../.projects.env/.*.env; do
    source $i
    docker-compose -p ${PROJECT_NAME} up --remove-orphans --build -d

    printf "${PROJECT_NAME}_REVIEW_PROXY=" >> .docker.env
    docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_review_1 >> .docker.env

    printf "${PROJECT_NAME}_PROD_PROXY=" >> .docker.env
    docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_prod_1 >> .docker.env

    printf "${PROJECT_NAME}_BETA_PROXY=" >> .docker.env
    docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_beta_1 >> .docker.env
done

