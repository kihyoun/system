#!/usr/bin/env bash
set -eo pipefail
if [[ ${SYSTEM_ROUTING_LOCK_HELD:-false} != true ]]; then
  exec 9>/tmp/system-bootstrapper-project-routing.lock
  flock 9
fi
# Preserve proxy address records if preparing a newly enabled route or reload
# fails. The entry proxy separately restores its previous active configuration.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
proxy_records=$script_dir/../nginx-proxy/.projects
snapshot=$(mktemp -d /tmp/system-project-proxies.XXXXXXXX)
mkdir -p "$proxy_records"
cp -a "$proxy_records/." "$snapshot/"
finish() {
  result=$?
  trap - EXIT
  if [[ $result != 0 ]]; then
    find "$proxy_records" -maxdepth 1 -type f -name '*.env' -delete
    cp -a "$snapshot/." "$proxy_records/" || result=1
  fi
  rm -rf -- "$snapshot"
  exit "$result"
}
trap finish EXIT
# Reuse the established proxy networks and templates, without stopping GitLab.
cd ../nginx-proxy
bash -e start.sh "$@"
cd ../nginx
bash -e start.sh reload
