#! /bin/bash
source ../.docker.env
source ../gitlab/.docker.env
source ../system/.docker.env
recovery=false
if [ "${1:-}" = recovery ]; then
  recovery=true
  SYNC_ENABLE=false
  WIZARD_ENABLE=false
fi

# Validate every saved host before replacing any generated route. An empty
# template also clears a previous alias after it is disabled or during the
# registry-only recovery phase; envsubst replaces the matching .conf file.
wizard_aliases=$(node ./wizard-aliases.js render ../system/.docker.env ../system/.projects.env "${1:-}") || exit $?
application_aliases=$(node ./application-aliases.js render ../system/.docker.env ../system/.projects.env "${1:-}") || exit $?

# A failed reload restores generated templates as well as the active config.
template_snapshot=$(mktemp -d /tmp/system-routing-templates.XXXXXXXX)
mkdir -p /templates
cp -a /templates/. "$template_snapshot/"
restore_templates() {
  result=$?
  trap - EXIT
  if [ "$result" != 0 ]; then
    find /templates -maxdepth 1 -type f -name "*.template" -delete
    cp -a "$template_snapshot/." /templates/ || result=1
  fi
  rm -rf -- "$template_snapshot"
  exit "$result"
}
trap restore_templates EXIT

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

mkdir -p /templates
cp ./.templates/acme-http01.conf.template /templates/00-acme-http01.conf.template
# Sort after default.conf so enabling aliases does not select a new default TLS host.
printf '%s\n' "$wizard_aliases" > /templates/zz-wizard-aliases.conf.template
printf '%s\n' "$application_aliases" > /templates/zz-application-aliases.conf.template

generate_nginx_conf $GITLAB_DOMAIN_MODE \
  gitlab \
  $GITLAB_IP \
  80 \
  $GITLAB_HOST \
  $GITLAB_SSL \
  $GITLAB_SSL_KEY > /templates/default.conf.template

# Candidate fragments belong to the versioned managed environment helper.
# Preserve them when the main configuration is rendered on start/reload.
if [ "$recovery" != true ]; then
  printf '\ninclude /etc/nginx/templates/wizard-environments/*.conf;\n' >> /templates/default.conf.template
fi

generate_nginx_conf $GITLAB_REGISTRY_DOMAIN_MODE \
  registry \
  $GITLAB_IP \
  5050 \
  $GITLAB_REGISTRY_HOST \
  $GITLAB_REGISTRY_SSL \
  $GITLAB_REGISTRY_SSL_KEY >> /templates/default.conf.template

function generate_proxy_config {
  source ../nginx-proxy/.projects/.$PROJECT_NAME.env

  if [ "$USE_PROD_HOST" = true ]; then
    generate_nginx_conf $PROD_DOMAIN_MODE \
    ${PROJECT_NAME}_prod \
    $PROD_PROXY \
    80 \
    $PROD_HOST \
    $PROD_SSL \
    $PROD_SSL_KEY \
    >> /templates/default.conf.template
  fi

  if [ "$USE_BETA_HOST" = true ]; then
    generate_nginx_conf $BETA_DOMAIN_MODE \
    ${PROJECT_NAME}_beta \
    $BETA_PROXY \
    80 \
    $BETA_HOST \
    $BETA_SSL \
    $BETA_SSL_KEY \
    >> /templates/default.conf.template
  fi

  if [ "$USE_REVIEW_HOST" = true ]; then
    generate_nginx_conf $REVIEW_DOMAIN_MODE \
    ${PROJECT_NAME}_review \
    $REVIEW_PROXY \
    80 \
    $REVIEW_HOST \
    $REVIEW_SSL \
    $REVIEW_SSL_KEY \
    >> /templates/default.conf.template
  fi
}

for i in $(find -H ../system/.projects.env ../system/projects.env -type f -name "*.env" 2>/dev/null); do
  [ "$recovery" = true ] && break
  source $i
  # Its production domain is already rendered by the main WIZARD settings below.
  if [ "${PROJECT_TEMPLATE:-}" = wizard ] && [ "$PROJECT_NAME" = wizard ]; then continue; fi
  generate_proxy_config
done

 [ $SYNC_ENABLE = true ] && generate_nginx_conf $SYNC_DOMAIN_MODE \
    sync \
    $BOOTSTRAPPER_IP \
    8071 \
    $SYNC_HOST \
    $SYNC_SSL \
    $SYNC_SSL_KEY \
    >> /templates/default.conf.template

 if [ $WIZARD_ENABLE = true ]; then
    source ../wizard/.docker.env

    generate_nginx_conf $WIZARD_DOMAIN_MODE \
      wizard \
      $WIZARD_IP \
      80 \
      $WIZARD_HOST \
      $WIZARD_SSL \
      $WIZARD_SSL_KEY \
      >> /templates/default.conf.template
  fi

if [ "${1:-}" = reload ]; then
    # Render the updated shared templates and reload the existing entry proxy.
    # The asynchronous project status endpoint stays reachable during setup.
    docker exec system_web_1 sh -ec '
      snapshot=$(mktemp -d /tmp/system-routing-conf.XXXXXXXX)
      cp -a /etc/nginx/conf.d/. "$snapshot/"
      rollback() {
        result=$?
        trap - EXIT
        if [ "$result" != 0 ]; then
          rm -f /etc/nginx/conf.d/*.conf
          cp -a "$snapshot/." /etc/nginx/conf.d/
          nginx -t && nginx -s reload || {
            echo "Previous proxy configuration could not be reloaded; inspect the proxy before retrying." >&2
            result=1
          }
        fi
        rm -rf "$snapshot"
        exit "$result"
      }
      trap rollback EXIT
      /docker-entrypoint.d/20-envsubst-on-templates.sh
      nginx -t
      nginx -s reload
    '

else
    docker-compose -f ../system/docker-compose.yml up --build --remove-orphans --force-recreate -d web
fi
