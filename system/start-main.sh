#! /bin/bash
set -eo pipefail
cd ../nginx; bash -e ./start.sh;
source ../system/.docker.env
if [ "${SYNC_ENABLE:-false}" != true ] && [ "${WIZARD_ENABLE:-false}" = true ]; then
  # Registration also works when the optional Sync listener is disabled.
  cd ../sync
  npm run build
  node dist/DefaultWizard.js || echo 'System Wizard registration failed; the existing interface remains available.' >&2
fi
cd ../sync; bash -e ./start.sh;
