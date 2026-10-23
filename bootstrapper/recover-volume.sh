#!/usr/bin/env bash
# Recover declared images and retained live data, never an older Seed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ $# == 0 || ( $# == 1 && $1 == --verify ) ]] || {
    echo 'Usage: recover-volume.sh [--verify]' >&2; exit 1;
}
: "${PERSISTENCE_ENV_FILE:?Set PERSISTENCE_ENV_FILE to the retained recovery/persistence.env}"
set -a
source "$PERSISTENCE_ENV_FILE"
set +a
bash bootstrapper/persistence.sh
recovery="$PERSISTENT_DIR/recovery"
verify=(--directory "$recovery" --configuration "$PERSISTENT_DIR/configuration/.docker.env")
if [[ -n ${RECOVERY_MANIFEST_SHA256:-} ]]; then
    verify+=(--expected-manifest-sha256 "$RECOVERY_MANIFEST_SHA256")
fi
python3 bootstrapper/recovery.py verify "${verify[@]}"
if [[ ${1:-} == --verify ]]; then exit 0; fi
[[ -f $PERSISTENT_DIR/configuration/.docker.env ]] || {
    echo 'Retained live configuration is required; use the first-install path for a new instance.' >&2; exit 1;
}
install -d -m 0700 /etc/system-bootstrapper
if [[ $(realpath "$PERSISTENCE_ENV_FILE") != /etc/system-bootstrapper/persistence.env ]]; then
    install -m 0600 "$PERSISTENCE_ENV_FILE" /etc/system-bootstrapper/persistence.env
fi
export PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
export DOCKER_HOST=unix:///var/run/docker.sock
python3 bootstrapper/recovery.py load "${verify[@]}"
bash bootstrapper/install-volume-host.sh
export SYSTEM_BOOTSTRAPPER_SKIP_BUILD=1
bash start.sh
