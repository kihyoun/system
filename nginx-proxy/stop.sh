#! /bin/bash
for i in $(find ../.projects.env ../projects.env -type f -name "*.env" 2>/dev/null); do
    source $i
    [ $USE_BETA_HOST = true ] && export BETA_SCALE=1 || export BETA_SCALE=0
    [ $USE_REVIEW_HOST = true ] && export REVIEW_SCALE=1 || export REVIEW_SCALE=0
    [ $USE_PROD_HOST = true ] && export PROD_SCALE=1 || export PROD_SCALE=0
    docker-compose -p ${PROJECT_NAME} down
done

