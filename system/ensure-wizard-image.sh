#!/bin/bash
set -euo pipefail
if [ ! -f .docker.env ]; then exit 0; fi
set -a
source .docker.env
set +a
node ./wizard-image-recovery.js
