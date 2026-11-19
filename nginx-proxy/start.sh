#! /bin/bash
set -euo pipefail
if [[ -f ../system/.docker.env ]]; then source ../system/.docker.env; fi
export NGINX_PROXY_IMAGE=${NGINX_PROXY_IMAGE:-}
mkdir -p ./.projects
next=
trap '[[ -z $next ]] || rm -f -- "$next"' EXIT
for file in ../system/.projects.env/*.env ../system/.projects.env/.*.env ../system/projects.env/*.env ../system/projects.env/.*.env; do
    [[ -f $file ]] || continue
    # Do not carry omitted settings from a preceding project's shell environment.
    PROJECT_NAME= PROJECT_TEMPLATE= USE_PROD_HOST=false USE_BETA_HOST=false USE_REVIEW_HOST=false
    source "$file"
    if [[ ${PROJECT_TEMPLATE:-} == wizard && $PROJECT_NAME == wizard ]]; then continue; fi
    if (( $# )); then
        selected=false
        for key in "$@"; do [[ $PROJECT_NAME != "$key" ]] || selected=true; done
        [[ $selected == true ]] || continue
    fi
    [[ $PROJECT_NAME =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid project proxy identity.' >&2; exit 1; }
    env_file=./.projects/.$PROJECT_NAME.env
    next=$(mktemp ./.projects/.routing.XXXXXXXX)
    for environment in prod beta review; do
        upper=${environment^^}
        enabled=USE_${upper}_HOST
        if [[ ${!enabled} == true ]]; then
            # Keep existing proxies, images and all sibling environment containers.
            docker-compose -p "$PROJECT_NAME" up --no-recreate --no-build -d "$environment"
            printf '%s_PROXY=' "$upper" >> "$next"
            docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${PROJECT_NAME}_${environment}_1" >> "$next"
        fi
    done
    mv -f -- "$next" "$env_file"
    next=
done
