#!/usr/bin/env bash
# Shared lease with Harvest: managed renewals cannot change the copied TLS state.
set -euo pipefail
set -a
source "${PERSISTENCE_ENV_FILE:-/etc/system-bootstrapper/persistence.env}"
set +a
mountpoint -q "$PERSISTENT_MOUNT"
[ "$(findmnt -rn -T "$PERSISTENT_DIR" -o TARGET)" = "$PERSISTENT_MOUNT" ]
[ "$(cat "$PERSISTENT_DIR/.system-bootstrapper-volume")" = system-bootstrapper-persistence-v1 ]
if [ -n "${PERSISTENT_UUID:-}" ]; then
    [ "$(findmnt -rn -T "$PERSISTENT_MOUNT" -o UUID)" = "$PERSISTENT_UUID" ]
fi
lock="$PERSISTENT_DIR/host/letsencrypt/.system-bootstrapper-certificate-lock"
mkdir "$lock" || { echo 'Certificate renewal/Harvest is active or was interrupted.' >&2; exit 1; }
trap 'rmdir "$lock"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/bin/certbot "$@"
