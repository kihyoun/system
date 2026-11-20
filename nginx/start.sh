#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec node "$root/operations/dist/projects-routing/entry.js" routing "${1:-start}" "$root" /templates
