#! /bin/bash
set -euo pipefail

for directory in /srv /ssl; do
    if [ ! -d "$directory" ]; then
        echo "Cannot harvest: missing $directory" >&2
        exit 1
    fi
done
mkdir -p /seed/ssl /seed/srv
rsync -av --delete /ssl/ /seed/ssl
rsync -av --delete /srv/ /seed/srv
