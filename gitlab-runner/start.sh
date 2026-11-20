#!/usr/bin/env bash
set -euo pipefail
# Retain the shared native registration mutex for compatibility callers.
exec 9>/tmp/system-bootstrapper-runner-registration.lock
flock -n 9 || { echo 'Runner registration already in progress.' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec node "$root/operations/dist/lifecycle/entry.js" runner-start "$root" "$@"
