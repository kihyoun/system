#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_runtime=/opt/system-bootstrapper-runtime/bin/node
if [[ ! -x $node_runtime ]]; then node_runtime=node; fi
exec "$node_runtime" "$root/operations/dist/host-lifecycle/entry.js" persistence
