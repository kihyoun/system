#! /bin/bash
source ../.docker.env
source ../gitlab/.docker.env

mkdir -p $NGINX_TEMPLATE_DIR

function generate_conf {
    cat $1 | sed -e "s@\${PROXY_UPSTREAM}@$2@g" \
      -e "s@\${PROXY_IP}@$3@g" \
      -e "s@\${PROXY_PORT}@$4@g" \
      -e "s@\${PROXY_HOSTNAME}@$5@g"
}

function generate_ssl_conf {
    cat $1 | sed -e "s@\${PROXY_UPSTREAM}@$2@g" \
      -e "s@\${PROXY_IP}@$3@g" \
      -e "s@\${PROXY_PORT}@$4@g" \
      -e "s@\${PROXY_HOSTNAME}@$5@g" \
      -e "s@\${PROXY_SSL_CERT_PATH}@$6@g" \
      -e "s@\${PROXY_SSL_CERT_KEY_PATH}@$7@g"
}

function generate_nginx_conf {
  case "$1" in
  0) generate_conf ./.templates/default.conf.template $2 $3 $4 $5 ;;
  1) generate_conf ./.templates/default.wildcard.conf.template $2 $3 $4 $5 ;;
  2) generate_ssl_conf ./.templates/default.ssl.conf.template $2 $3 $4 $5 $6 $7 ;;
  3) generate_ssl_conf ./.templates/default.wildcard.ssl.conf.template $2 $3 $4 $5 $6 $7 ;;
  esac
}

generate_nginx_conf $GITLAB_DOMAIN_MODE \
  $GITLAB_UPSTREAM \
  $GITLAB_IP \
  $GITLAB_PORT \
  $GITLAB_HOST \
  $GITLAB_SSL \
  $GITLAB_SSL_KEY > $NGINX_TEMPLATE_DIR/default.conf.template

generate_nginx_conf $GITLAB_REGISTRY_DOMAIN_MODE \
  $GITLAB_REGISTRY_UPSTREAM \
  $GITLAB_IP \
  $GITLAB_REGISTRY_PORT \
  $GITLAB_REGISTRY_HOST \
  $GITLAB_REGISTRY_SSL \
  $GITLAB_REGISTRY_SSL_KEY >> $NGINX_TEMPLATE_DIR/default.conf.template

function generate_proxy_config {
  source ../nginx-proxy/.projects/.$PROJECT_NAME.env

  generate_nginx_conf $PROD_DOMAIN_MODE \
    ${PROJECT_NAME}_prod \
    $PROD_PROXY \
    $PROD_PORT \
    $PROD_HOST \
    $PROD_SSL \
    $PROD_SSL_KEY \
    >> $NGINX_TEMPLATE_DIR/default.conf.template

  [ $USE_BETA_HOST = true ] && generate_nginx_conf $BETA_DOMAIN_MODE \
    ${PROJECT_NAME}_beta \
    $BETA_PROXY \
    $BETA_PORT \
    $BETA_HOST \
    $BETA_SSL \
    $BETA_SSL_KEY \
    >> $NGINX_TEMPLATE_DIR/default.conf.template

  [ $USE_REVIEW_HOST = true ] && generate_nginx_conf $REVIEW_DOMAIN_MODE \
    ${PROJECT_NAME}_review \
    $REVIEW_PROXY \
    $REVIEW_PORT \
    $REVIEW_HOST \
    $REVIEW_SSL \
    $REVIEW_SSL_KEY \
    >> $NGINX_TEMPLATE_DIR/default.conf.template
}

for i in ../.projects.env/.*.env; do
  source $i
  generate_proxy_config
done

docker-compose up --build --remove-orphans -d
