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
services_touched=false
quiesce_complete=false
last_gitlab_state=''
# Stop clients and the in-container stopper have separate finite deadlines. A
# killed Docker exec client alone would leave its remote command running.
monotonic_seconds() {
    local uptime rest
    read -r uptime rest </proc/uptime
    printf '%s\n' "${uptime%%.*}"
}
stop_call() {
    local remaining=$((stop_deadline - $(monotonic_seconds) - 1))
    [ "$remaining" -gt 0 ] || return 124
    timeout -k 1 "$remaining" "$@"
}
state_valid() {
    [[ $1 =~ ^(true|false)\ ([0-9]{1,3})\ (true|false)$ ]] && [ "${BASH_REMATCH[2]}" -le 255 ]
}
services_down='
found=false
for service in /opt/gitlab/service/*; do
    [ -L "$service" ] || continue
    found=true
    state=$(/opt/gitlab/embedded/bin/sv status "$service")
    case "$state" in down:\ *) ;; *) exit 1 ;; esac
done
[ "$found" = true ]'
services_up='
found=false
failed=0
for service in /opt/gitlab/service/*; do
    [ -L "$service" ] || continue
    found=true
    /opt/gitlab/embedded/bin/sv u "$service" >/dev/null || failed=1
done
[ "$found" = true ] && [ "$failed" = 0 ]'
quiesce_services='
read -r uptime rest </proc/uptime
remaining=$(($1 - ${uptime%%.*}))
code=124
if [ "$remaining" -gt 0 ] && [ "$remaining" -le 120 ]; then
    code=0
    timeout -k 1 "$remaining" gitlab-ctl stop >/dev/null 2>&1 || code=$?
fi
printf "harvest-quiesce-exit:%s\n" "$code"'
# Source-owned phase names classify a failure without reporting paths or data.
certificate_lock=false
phase=certificate-lock
finish() {
    result=$?
    trap - EXIT INT TERM
    if [ "$services_touched" = true ] && [ "$quiesce_complete" = false ]; then
        # A lost/interrupted Docker client is not a remote completion witness.
        # Both containers share the kernel's monotonic uptime. A delayed remote
        # start checks this same absolute deadline before touching any service.
        while [ "$(monotonic_seconds)" -le "$((quiesce_deadline + 2))" ]; do sleep 1; done
    fi
    if [ "$result" -ne 0 ]; then
        printf 'Harvest phase failed: %s.\n' "$phase" >&2
        if [ -z "$last_gitlab_state" ] && [[ $phase == gitlab-* ]]; then
            last_gitlab_state=$(timeout -k 1 4 docker inspect --format '{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$gitlab" 2>/dev/null) || last_gitlab_state=''
        fi
        if state_valid "$last_gitlab_state"; then
            printf 'Harvest GitLab state: running=%s exitCode=%s oomKilled=%s.\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" >&2
        else
            printf 'Harvest GitLab state: unavailable.\n' >&2
        fi
    fi
    if [ "$resume" = true ]; then
        resumed=false
        if running_now=$(timeout -k 1 4 docker inspect --format '{{.State.Running}}' "$gitlab" 2>/dev/null); then
            if [ "$running_now" = false ]; then
                if timeout -k 1 14 docker start "$gitlab" >/dev/null 2>&1; then resumed=true; fi
            elif [ "$running_now" = true ]; then
                if [ "$services_touched" = false ] || timeout -k 1 14 docker exec "$gitlab" timeout -k 1 10 /bin/sh -ec "$services_up" >/dev/null 2>&1; then resumed=true; fi
            fi
        fi
        if [ "$resumed" = false ]; then
            echo 'GitLab restart failed after Harvest.' >&2
            [ "$result" -ne 0 ] || result=1
        fi
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
phase=gitlab-inspect
stop_deadline=$(($(monotonic_seconds) + 120))
running=$(stop_call docker inspect --format '{{.State.Running}}' "$gitlab")
export GITLAB_IMAGE GITLAB_IMAGE_ID
GITLAB_IMAGE_ID=$(stop_call docker inspect --format '{{.Image}}' "$gitlab")
GITLAB_IMAGE=$(stop_call docker inspect --format '{{.Config.Image}}' "$gitlab")
if [ "$running" = true ]; then
    resume=true
    phase=gitlab-quiesce
    # GitLab's image wrapper otherwise uses runit's 30-second service timeout.
    # Give services longer to finish, but reserve time for the final container
    # stop inside the same 120-second budget. Never copy after a partial stop.
    quiesce_budget=$((stop_deadline - $(monotonic_seconds) - 8))
    [ "$quiesce_budget" -gt 3 ] || exit 124
    quiesce_deadline=$((stop_deadline - 12))
    services_touched=true
    quiesce_response=$(timeout -k 1 "$quiesce_budget" docker exec --env SVWAIT=90 "$gitlab" /bin/sh -ec "$quiesce_services" sh "$quiesce_deadline" 2>/dev/null)
    if [[ $quiesce_response =~ ^harvest-quiesce-exit:(0|[1-9][0-9]{0,2})$ ]] && [ "${BASH_REMATCH[1]}" -le 255 ]; then
        quiesce_complete=true
    else
        exit 1
    fi
    [ "${BASH_REMATCH[1]}" = 0 ] || exit "${BASH_REMATCH[1]}"
    phase=gitlab-services-down
    stop_call docker exec "$gitlab" /bin/sh -ec "$services_down" >/dev/null 2>&1
    phase=gitlab-stop
    remaining=$((stop_deadline - $(monotonic_seconds) - 3))
    [ "$remaining" -gt 0 ] || exit 124
    stop_call docker stop --time "$remaining" "$gitlab" >/dev/null
fi
phase=gitlab-stopped-check
last_gitlab_state=$(stop_call docker inspect --format '{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$gitlab")
state_valid "$last_gitlab_state"
[ "${BASH_REMATCH[1]}" = false ]
# Docker's stop timeout can SIGKILL an application. Require a clean final
# container exit independently of the preceding service quiescence.
phase=gitlab-clean-exit
[ "${BASH_REMATCH[2]}" = 0 ] && [ "${BASH_REMATCH[3]}" = false ] || {
    echo 'GitLab did not shut down cleanly; no Seed published.' >&2; exit 1;
}
phase=stage-create
stage=$(mktemp -d "$seed/.harvest-XXXXXXXX")
mkdir "$stage/srv" "$stage/ssl" "$stage/letsencrypt"
phase=srv-copy
rsync -a --no-specials --no-devices --fsync --delete "$srv/" "$stage/srv/"
phase=ssl-copy
rsync -a --no-specials --no-devices --fsync --delete "$ssl/" "$stage/ssl/"
phase=certbot-copy
rsync -a --no-specials --no-devices --fsync --delete --exclude=.system-bootstrapper-certificate-lock "$certbot/" "$stage/letsencrypt/"
phase=manifest-create
node "$scripts/seed-manifest.js" create "$stage"
phase=snapshot-publish
node "$scripts/seed-manifest.js" publish "$seed" "$stage"
stage=''
echo 'Harvest completed; previous snapshots remain available.'
