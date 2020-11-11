#! /bin/bash
for i in $(find ../.projects.env ../projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    ENV_FILE=./.projects/.$PROJECT_NAME.env
    echo > $ENV_FILE

    if [ $USE_BETA_HOST = true ]; then
        docker-compose -p ${PROJECT_NAME} up --remove-orphans --build -d beta
        printf "BETA_PROXY=" >> $ENV_FILE
        docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_beta_1 >> $ENV_FILE
    fi

    if [ $USE_PROD_HOST = true ]; then
        docker-compose -p ${PROJECT_NAME} up --remove-orphans --build -d prod
        printf "PROD_PROXY=" >> $ENV_FILE
        docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_prod_1 >> $ENV_FILE
    fi

    if [ $USE_REVIEW_HOST = true ]; then
        docker-compose -p ${PROJECT_NAME} up --remove-orphans --build -d review
        printf "REVIEW_PROXY=" >> $ENV_FILE
        docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_review_1 >> $ENV_FILE
    fi


 done

