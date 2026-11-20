#!/bin/sh
# Test-only registry transport for a not-yet-published candidate. Every mapped
# image ID was checked against the prepared archive and source/job labels.
set -eu
: "${SYSTEM_PUBLIC_UPGRADE_FIXTURE:?}"
fixture=$SYSTEM_PUBLIC_UPGRADE_FIXTURE
map_image() {
    input=$1
    normalized=${input#docker.io/}
    row=$(awk -F '\t' -v reference="$normalized" '$1 == reference {print $2 " " $3}' "$fixture/images.tsv")
    if [ -n "$row" ]; then
        set -- $row
        if [ "$2" = previous ] && [ -f "$fixture/offline-recovery" ]; then
            echo 'Previous public registry transport is unavailable.' >&2
            return 87
        fi
        printf '%s' "$1"
    else
        printf '%s' "$input"
    fi
}
case ${0##*/}:$* in
    docker-compose:*|docker:*' compose '*)
        if [ "${0##*/}" = docker ]; then
            # The native caller always supplies the fixed host before compose.
            [ "$1" = --host=unix:///var/run/docker.sock ] && shift
            [ "$1" = compose ]; shift
        fi
        for key in BOOTSTRAPPER_IMAGE WIZARD_IMAGE; do
            eval 'value=${'"$key"'-}'
            if [ -n "$value" ]; then export "$key=$(map_image "$value")"; fi
        done
        case " $* " in
            *system/docker-compose.yml*)
                count=$#; inserted=
                while [ "$count" -gt 0 ]; do
                    value=$1; shift
                    case $value in up|create)
                        if [ -z "$inserted" ]; then set -- "$@" -f "$fixture/compose.yml"; inserted=yes; fi ;;
                    esac
                    set -- "$@" "$value"; count=$((count - 1))
                done ;;
        esac
        case "${BOOTSTRAPPER_IMAGE:-}:$*" in
            system-bootstrapper-recovery:*' bootstrapper')
                if [ -f "$fixture/fail-recovery-once" ]; then
                    rm "$fixture/fail-recovery-once"
                    echo 'Injected one-shot recovery transport failure.' >&2
                    exit 88
                fi ;;
        esac
        exec "$fixture/docker-compose.native" "$@" ;;
esac
# Preserve argument boundaries while replacing only exact declared selectors.
count=$#
original=
while [ "$count" -gt 0 ]; do
    value=$1; shift
    mapped=$(map_image "$value")
    if [ "$mapped" != "$value" ]; then original=${value#docker.io/}; fi
    set -- "$@" "$mapped"
    count=$((count - 1))
done
case " $* " in
    *' pull '*)
        # Prepared bytes model the exact future public download; no repull.
        [ -z "$original" ] || exec "$fixture/docker.native" image inspect "$mapped" ;;
esac
if [ -n "$original" ] && [ "${1:-}" = --host=unix:///var/run/docker.sock ] && [ "${2:-}" = image ] && [ "${3:-}" = inspect ]; then
    # The containerd store retains digests derived from local archive tags;
    # classic storage may return an empty array. Both represent the same
    # prepared bytes behind this exact fixture-only publication selector.
    # Capture first so a failing native inspection cannot be hidden by sed.
    inspected=$("$fixture/docker.native" "$@")
    printf '%s\n' "$inspected" | sed -e ':collect' -e '$!{N;bcollect;}' \
        -e 's|"RepoDigests":[[:space:]]*\[[^]]*\]|"RepoDigests": ["'"$original"'"]|g'
else
    exec "$fixture/docker.native" "$@"
fi
