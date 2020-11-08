#! /bin/bash
for i in $(find ../.projects.env ../projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    ENV_FILE=./.projects/.$PROJECT_NAME.env
    echo > $ENV_FILE

    [ $USE_BETA_HOST = true ] && export BETA_SCALE=1 || export BETA_SCALE=0;
    [ $USE_REVIEW_HOST = true ] && export REVIEW_SCALE=1 || export REVIEW_SCALE=0;
    [ $USE_PROD_HOST = true ] && export PROD_SCALE=1 || export PROD_SCALE=0;

    docker-compose -f ../system/docker-compose.yml -p ${PROJECT_NAME} up --remove-orphans --build -d review prod beta

    if [ $USE_PROD_HOST = true ]; then
        printf "PROD_PROXY=" >> $ENV_FILE
        docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_prod_1 >> $ENV_FILE
    fi

    if [ $USE_BETA_HOST = true ]; then
        printf "BETA_PROXY=" >> $ENV_FILE
        docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_beta_1 >> $ENV_FILE
    fi

    if [ $USE_REVIEW_HOST = true ]; then
        printf "REVIEW_PROXY=" >> $ENV_FILE
        docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${PROJECT_NAME}_review_1 >> $ENV_FILE
    fi

 done

