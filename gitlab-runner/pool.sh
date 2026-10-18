#!/usr/bin/env bash

# Compose scaling shares one service's bind mounts. Generate a separate service
# for each manager so its token, system ID and home remain isolated on disk.
runner_pool() {
    local operation="$1" pool="$2" count="$GITLAB_RUNNER_SCALE" definition_file result=0
    if ! [[ "$count" =~ ^([0-9]|[1-4][0-9]|50)$ ]]; then
        echo 'Runner count must be an integer from 0 to 50.' >&2
        return 1
    fi
    # Compose needs a nonempty service model even when taking a pool down.
    if [ "$operation" = down ] || [ "$count" = 0 ]; then count=1; operation=down; fi
    definition_file=$(mktemp /tmp/system-runner-compose.XXXXXXXX.json)
    local prepare=()
    if [ "$operation" = up ]; then prepare=(--prepare); fi
    if node compose.js "$pool" "$count" "${PERSISTENT_DIR:-}" "${prepare[@]}" > "$definition_file"; then
        if [ "$operation" = up ]; then
            docker-compose -p "$pool" -f "$definition_file" up --remove-orphans -d || result=$?
        else
            docker-compose -p "$pool" -f "$definition_file" down --remove-orphans || result=$?
        fi
    else
        result=1
    fi
    rm -f -- "$definition_file"
    return "$result"
}
