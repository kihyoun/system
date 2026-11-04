#!/usr/bin/env bash
# Host entry point. The accepted image contains all operation implementation.
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
operation=${1:-}; shift || true
[[ $operation == harvest || $operation == restore ]] || { echo 'Usage: seed-operation.sh harvest|restore --image IMAGE [--configuration-backup ZIP] [--check-only]' >&2; exit 2; }
image= backup= check=()
while (( $# )); do
    case $1 in
        --image|--configuration-backup)
            (( $# >= 2 )) || exit 2
            if [[ $1 == --image ]]; then image=$2; else backup=$2; fi
            shift 2 ;;
        --check-only) check=(--check-only); shift ;;
        *) exit 2 ;;
    esac
done
(( EUID == 0 )) || { echo 'Run as root.' >&2; exit 1; }
[[ -n $image ]] || { echo 'Select the accepted complete controller image.' >&2; exit 1; }
: "${PERSISTENCE_ENV_FILE:?Select private host storage settings}"
set -a
source "$PERSISTENCE_ENV_FILE"
source bootstrapper/storage-env.sh
set +a
if (( ${#check[@]} )); then PERSISTENCE_CHECK_ONLY=1 bash bootstrapper/persistence.sh
else bash bootstrapper/persistence.sh
fi
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
export DOCKER_HOST=unix:///var/run/docker.sock
image_id=$(docker image inspect --format '{{.Id}}' "$image")
[[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
if [[ -n $backup ]]; then
    [[ $operation == restore && $backup == /* && -f $backup && ! -L $backup ]] || exit 1
fi
# This short-lived launcher only reads host storage/configuration selectors.
# The owned operation child creates its writable mounts after validation.
docker run --rm --network none --entrypoint node \
    --mount type=bind,src=/,dst=/host,readonly \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --env "PERSISTENCE_ENV_FILE=$PERSISTENCE_ENV_FILE" \
    --env "SYSTEM_SEED_CONTROLLER_IMAGE=$image_id" \
    --env "SYSTEM_SEED_CONFIGURATION_BACKUP=$backup" \
    "$image_id" /system/system/seed-operation.js host "$operation" "${check[@]}"
