#! /bin/bash
source ../.docker.env
mkdir -p $NGINX_TEMPLATE_DIR
cat ./templates/beta.conf.template  \
    ./templates/registry.conf.template \
    ./templates/gitlab.conf.template \
    ./templates/prod.conf.template \
    ./templates/review.conf.template \
    | sed -e "s@\${BETA_PROXY}@$BETA_PROXY@g" \
    -e "s@\${NGINX_BETA_HOSTNAME}@$NGINX_BETA_HOSTNAME@g" \
    -e "s@\${GITLAB_IP}@$GITLAB_IP@g" \
    -e "s@\${GITLAB_HOSTNAME}@$GITLAB_HOSTNAME@g" \
    -e "s@\${PROD_PROXY}@$PROD_PROXY@g" \
    -e "s@\${NGINX_PROD_HOSTNAME}@$NGINX_PROD_HOSTNAME@g" \
    -e "s@\${GITLAB_REGISTRY_HOST}@$GITLAB_REGISTRY_HOST@g" \
    -e "s@\${REVIEW_PROXY}@$REVIEW_PROXY@g" \
    > $NGINX_TEMPLATE_DIR/default.conf.template

export NGINX_TEMPLATE_DIR=$NGINX_TEMPLATE_DIR



