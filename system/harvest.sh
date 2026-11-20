#!/bin/bash
set -euo pipefail
umask 077
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ ${SYSTEM_SEED_HELPER:-0} == 1 ]]; then
    exec node "$scripts/../operations/dist/storage/copy-entry.js" harvest "$@"
fi
exec node "$scripts/seed-operation.js" launch harvest "$@"
