#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec node "$root/operations/dist/lifecycle/entry.js" gitlab-start "$root"
