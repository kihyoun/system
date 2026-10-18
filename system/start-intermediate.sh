#! /bin/bash
set -eo pipefail
cd ../gitlab; bash -e ./start.sh;
cd ../system; bash -e ./ensure-wizard-image.sh;
cd ../nginx-proxy; bash -e ./start.sh;
cd ../gitlab-runner
if ! bash -e ./start.sh; then
  echo 'Runner setup failed. The platform will continue so you can correct the configuration in the Wizard.' >&2
fi
cd ../wizard; bash -e ./start.sh;
