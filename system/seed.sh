#!/bin/bash
set -euo pipefail
umask 077
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
seed=${SEED_ROOT:-/seed}
srv=${SERVICE_DATA_DIR:-/srv}
ssl=${TLS_DATA_DIR:-/ssl}
certbot=${LETSENCRYPT_DATA_DIR:-/host-letsencrypt}
gitlab=${GITLAB_CONTAINER:-system_gitlab_1}
if [ ! -e "$seed/current" ] && [ ! -L "$seed/current" ] && [ ! -e "$seed/srv" ] && [ ! -e "$seed/ssl" ]; then
    echo 'No seed found; continuing without restore.'
    exit 0
fi
mkdir "$seed/.operation-lock" || { echo 'A Harvest/Seed operation is already active or was interrupted.' >&2; exit 1; }
certificate_lock=false
finish() {
    result=$?
    trap - EXIT INT TERM
    if [ "$certificate_lock" = true ]; then rmdir "$certbot/.system-bootstrapper-certificate-lock" || result=1; fi
    rmdir "$seed/.operation-lock" || result=1
    exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Fail closed if Docker is unavailable; an absent GitLab container is expected
# during fresh-host restore, a running one must never be overwritten.
docker info >/dev/null
container=$(docker ps -aq --filter "name=^/${gitlab}$")
if [ -n "$container" ] && [ "$(docker inspect --format '{{.State.Running}}' "$gitlab")" = true ]; then
    echo 'Stop GitLab before restoring a Seed.' >&2; exit 1
fi
if [ -L "$seed/current" ] || [ -e "$seed/current" ]; then
    source=$(node "$scripts/seed-manifest.js" current "$seed")
else
    echo 'Legacy Seed has no completion/consistency manifest; create a new Harvest before restore.' >&2
    exit 1
fi
# Match the exact image content as well as its version/edition reference.
expected_image=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).gitlabImageId || "")' "$source/manifest.json")
[ -n "$expected_image" ] && [ "$(docker image inspect --format '{{.Id}}' "${GITLAB_IMAGE:?Set the harvested GitLab image reference}")" = "$expected_image" ] || {
    echo 'Restore requires the harvested GitLab image content.' >&2; exit 1;
}
# Validate ALL payload before the first destructive --delete. A failed restore
# leaves the marker and controller startup refuses to provision partial state.
mkdir -p "$certbot"
mkdir "$certbot/.system-bootstrapper-certificate-lock" || {
    echo 'Certificate renewal is active or was interrupted; resolve its lock before restore.' >&2; exit 1;
}
certificate_lock=true
mkdir -p "$srv/gitlab/data" "$ssl"
node "$scripts/seed-manifest.js" mark-restore "$srv"
rsync -a --no-specials --no-devices --fsync --delete --exclude=.system-bootstrapper-restore-incomplete "$source/srv/" "$srv/"
rsync -a --no-specials --no-devices --fsync --delete "$source/ssl/" "$ssl/"
rsync -a --no-specials --no-devices --fsync --delete --exclude=.system-bootstrapper-certificate-lock "$source/letsencrypt/" "$certbot/"
node "$scripts/seed-manifest.js" finish-restore "$source" "$srv" "$ssl" "$certbot"
echo 'Ready. Install host TLS renewal integration before starting services.'
