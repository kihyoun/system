#!/usr/bin/env bash
set -euo pipefail
set -a
source "${PERSISTENCE_ENV_FILE:-/etc/system-bootstrapper/persistence.env}"
set +a
if [[ ${PERSISTENCE_MODE:-volume} == local ]]; then
    [[ $PERSISTENT_MOUNT == / && $PERSISTENT_DIR == /* && $PERSISTENT_DIR != / ]]
    [[ $(realpath -e -- "$PERSISTENT_DIR") == "${PERSISTENT_DIR%/}" ]]
else
    [[ ${PERSISTENCE_MODE:-volume} == volume ]]
    mountpoint -q "$PERSISTENT_MOUNT"
    [ "$(findmnt -rn -T "$PERSISTENT_DIR" -o TARGET)" = "$PERSISTENT_MOUNT" ]
fi
[ "$(cat "$PERSISTENT_DIR/.system-bootstrapper-volume")" = system-bootstrapper-persistence-v1 ]
lineage=${RENEWED_LINEAGE:-/etc/letsencrypt/live/system-bootstrapper.com}
case "$lineage" in
    /etc/letsencrypt/live/*) name=${lineage##*/} ;;
    *) exit 1 ;;
esac
[[ "$name" =~ ^[A-Za-z0-9.-]+$ ]] || exit 1
target="$PERSISTENT_DIR/ssl/live/$name"
install -d -m 0700 "$target"
install -m 0644 "$lineage/fullchain.pem" "$target/fullchain.pem.next"
install -m 0600 "$lineage/privkey.pem" "$target/privkey.pem.next"
mv "$target/fullchain.pem.next" "$target/fullchain.pem"
mv "$target/privkey.pem.next" "$target/privkey.pem"
if [ "$(docker inspect --format '{{.State.Running}}' system_web_1 2>/dev/null || true)" = true ]; then
    docker exec system_web_1 nginx -t
    docker exec system_web_1 nginx -s reload
fi
