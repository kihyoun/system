#!/usr/bin/env bash
set -eo pipefail
exec 9>/tmp/system-bootstrapper-project-routing.lock
flock 9
# Reuse the established proxy networks and templates, without stopping GitLab.
cd ../nginx-proxy
bash -e start.sh
cd ../nginx
bash -e start.sh reload
