#!/usr/bin/env bash
set -euo pipefail
# Process-lifetime flock remains shared with project setup; policy is in TypeScript.
exec 9>/tmp/system-bootstrapper-project-routing.lock
flock 9
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec node "$root/operations/dist/configuration/entry.js" push "$root" "${SYSTEM_CONFIG_DIR:-$PWD}" "$PWD/../bootstrapper.zip"
