#!/usr/bin/env bash
# Compatibility entry; the prepared runtime and Nest host module own launch policy.
set -euo pipefail
umask 077
checkout=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node=/opt/system-bootstrapper-runtime/bin/node
if [[ -x $node ]]; then
    export PATH="$(dirname "$node"):$PATH"
else
    node=$(command -v node) || { echo 'Prepare the host operations runtime first.' >&2; exit 1; }
fi
exec "$node" "$checkout/operations/dist/host/storage-entry.js" "$@"
