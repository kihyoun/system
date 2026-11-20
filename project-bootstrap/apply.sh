#!/usr/bin/env bash
set -euo pipefail
# Retain the process-lifetime flock shared with configuration Push.
if [[ ${SYSTEM_ROUTING_LOCK_HELD:-false} != true ]]; then
  exec 9>/tmp/system-bootstrapper-project-routing.lock
  flock 9
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec node "$root/operations/dist/projects-routing/entry.js" routing apply "$root" /templates "$@"
