#! /bin/bash
set -eo pipefail
cd ../gitlab; bash -e ./start.sh;
cd ../nginx-proxy; bash -e ./start.sh;
cd ../gitlab-runner; bash -e ./start.sh;
cd ../wizard; bash -e ./start.sh;
