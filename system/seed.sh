#!/bin/bash
set -euo pipefail

# No seed is the normal first-boot case. Do not erase existing destination data.
if [ ! -e /seed/srv ] && [ ! -e /seed/ssl ]; then
    echo "No seed found; continuing without restore."
    exit 0
fi

# Validate the complete seed before rsync --delete can change either target.
for directory in /seed/srv /seed/ssl; do
    if [ ! -d "$directory" ]; then
        echo "Incomplete seed: missing $directory" >&2
        exit 1
    fi
done
mkdir -p /srv /ssl
rsync -av --progress --delete /seed/srv/ /srv
rsync -av --progress --delete /seed/ssl/ /ssl
echo 'Ready.'
