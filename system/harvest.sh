#!/bin/bash
set -euo pipefail
umask 077
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
seed=${SEED_ROOT:-/seed}
srv=${SERVICE_DATA_DIR:-/srv}
ssl=${TLS_DATA_DIR:-/ssl}
certbot=${LETSENCRYPT_DATA_DIR:-/host-letsencrypt}
gitlab=${GITLAB_CONTAINER:-system_gitlab_1}
for directory in "$srv" "$ssl" "$certbot"; do
    [ -d "$directory" ] || { echo 'Cannot harvest: service/TLS/renewal source is missing.' >&2; exit 1; }
done
[ ! -e "$srv/gitlab/data/.system-bootstrapper-restore-incomplete" ] || {
    echo 'Cannot harvest an incomplete restore; finish Seed recovery first.' >&2; exit 1;
}
mkdir -p "$seed"
# Shared with restore; a killed process leaves a visible lock for investigation.
mkdir "$seed/.operation-lock" || { echo 'A Harvest/Seed operation is already active or was interrupted.' >&2; exit 1; }
stage=''
resume=false
certificate_lock=false
finish() {
    result=$?
    trap - EXIT INT TERM
    if [ "$resume" = true ]; then
        docker start "$gitlab" >/dev/null || { echo 'GitLab restart failed after Harvest.' >&2; result=1; }
    fi
    if [ "$certificate_lock" = true ]; then rmdir "$certbot/.system-bootstrapper-certificate-lock" || result=1; fi
    [ -z "$stage" ] || rm -rf -- "$stage"
    rmdir "$seed/.operation-lock" || result=1
    exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$certbot/.system-bootstrapper-certificate-lock" || {
    echo 'Certificate renewal is active or was interrupted; retry after resolving its lock.' >&2; exit 1;
}
certificate_lock=true
# Verify the controlled application exists. Never claim consistency after an
# ignored Docker/API failure or while a different GitLab is writing this tree.
running=$(docker inspect --format '{{.State.Running}}' "$gitlab")
export GITLAB_IMAGE GITLAB_IMAGE_ID
GITLAB_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$gitlab")
GITLAB_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$gitlab")
if [ "$running" = true ]; then
    resume=true
    docker stop --time 120 "$gitlab" >/dev/null
fi
[ "$(docker inspect --format '{{.State.Running}}' "$gitlab")" = false ]
# Docker's stop timeout can SIGKILL an application. Only a clean shutdown is
# accepted as a consistent cold copy.
[ "$(docker inspect --format '{{.State.ExitCode}}' "$gitlab")" = 0 ] || {
    echo 'GitLab did not shut down cleanly; no Seed published.' >&2; exit 1;
}
stage=$(mktemp -d "$seed/.harvest-XXXXXXXX")
mkdir "$stage/srv" "$stage/ssl" "$stage/letsencrypt"
rsync -a --no-specials --no-devices --fsync --delete "$srv/" "$stage/srv/"
rsync -a --no-specials --no-devices --fsync --delete "$ssl/" "$stage/ssl/"
rsync -a --no-specials --no-devices --fsync --delete --exclude=.system-bootstrapper-certificate-lock "$certbot/" "$stage/letsencrypt/"
node "$scripts/seed-manifest.js" create "$stage"
node "$scripts/seed-manifest.js" publish "$seed" "$stage"
stage=''
echo 'Harvest completed; previous snapshots remain available.'
