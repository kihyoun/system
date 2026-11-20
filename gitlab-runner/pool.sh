#!/usr/bin/env bash
# Compatibility function for callers that already loaded their selected pool settings.
runner_pool() {
    local root
    root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
    GITLAB_RUNNER_SCALE="$GITLAB_RUNNER_SCALE" PERSISTENT_DIR="${PERSISTENT_DIR:-}" \
      node "$root/operations/dist/lifecycle/entry.js" runner-pool "$root" "$1" "$2"
}
