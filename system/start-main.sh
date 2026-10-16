#! /bin/bash
set -eo pipefail
cd ../nginx; bash -e ./start.sh;
cd ../sync; bash -e ./start.sh;
