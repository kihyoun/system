#!/bin/sh
# Trusted parent for the platform's existing Docker-socket runner.
# The candidate child receives no socket, host mounts, credentials or network.
set -eu

case "${CI_PROJECT_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_PROJECT_ID is required.' >&2; exit 2;; esac
case "${CI_JOB_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_JOB_ID is required.' >&2; exit 2;; esac
resource="system-tests-${CI_PROJECT_ID}-${CI_JOB_ID}"
image="system-component-tests:ci-${CI_PROJECT_ID}-${CI_JOB_ID}"

cleanup() {
  docker rm -f "$resource" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
if [ "${1:-}" = cleanup ]; then cleanup; exit 0; fi
case "${1:-}" in all|gitlab|sync|gitlab-runner|bootstrapper|nginx|wizard|shared) component="$1";;
  *) echo 'Select a documented isolated component.' >&2; exit 2;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p test-results

docker build --label "org.system-bootstrapper.test-job=$CI_JOB_ID" -f tests/Dockerfile -t "$image" .
docker create --name "$resource" --label "org.system-bootstrapper.test-job=$CI_JOB_ID" \
  --network none "$image" "$component" >/dev/null
docker start "$resource" >/dev/null
status=$(docker wait "$resource")
docker logs "$resource"
# Docker cp works with remote/shared daemons; a CI checkout path is not a host bind path.
docker cp "$resource:/candidate/test-results/." test-results/
case "$status" in
  0) exit 0;;
  *[!0-9]*|'') echo 'Container returned an invalid exit status.' >&2; exit 1;;
  *) exit "$status";;
esac
