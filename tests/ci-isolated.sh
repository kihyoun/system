#!/bin/sh
# Trusted parent for the platform's existing Docker-socket runner.
# The candidate child receives no socket, host mounts, credentials or network.
set -eu

case "${CI_PROJECT_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_PROJECT_ID is required.' >&2; exit 2;; esac
case "${CI_JOB_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_JOB_ID is required.' >&2; exit 2;; esac
resource="system-tests-${CI_PROJECT_ID}-${CI_JOB_ID}"
image="system-component-tests:ci-${CI_PROJECT_ID}-${CI_JOB_ID}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

cleanup() {
  cleanup_failed=0
  # Listing a single exact resource distinguishes an absent resource (success)
  # from an unreachable/read-only daemon. Bound each command for after_script.
  if containers=$(timeout 8 docker container ls --all --filter "name=^/${resource}$" --format '{{.Names}}' 2>/dev/null); then
    if [ -n "$containers" ]; then
      if [ "$containers" != "$resource" ] || ! timeout 8 docker rm -f "$resource" >/dev/null 2>&1; then
        echo 'Failed to remove the job-scoped test container.' >&2
        cleanup_failed=1
      fi
    fi
  else
    echo 'Could not inspect the job-scoped test container during cleanup.' >&2
    cleanup_failed=1
  fi
  if images=$(timeout 8 docker image ls --filter "reference=$image" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null); then
    if [ -n "$images" ]; then
      if [ "$images" != "$image" ] || ! timeout 8 docker image rm "$image" >/dev/null 2>&1; then
        echo 'Failed to remove the job-scoped test image.' >&2
        cleanup_failed=1
      fi
    fi
  else
    echo 'Could not inspect the job-scoped test image during cleanup.' >&2
    cleanup_failed=1
  fi
  cleanup_state=passed
  [ "$cleanup_failed" -eq 0 ] || cleanup_state=failed
  if ! { mkdir -p test-results/cleanup && printf '{"container":"%s","image":"%s","status":"%s"}\n' \
    "$resource" "$image" "$cleanup_state" > "test-results/cleanup/$1.json"; } 2>/dev/null; then
    echo 'Could not write the cleanup status artifact.' >&2
    cleanup_failed=1
  fi
  if [ "$cleanup_failed" -ne 0 ]; then
    echo 'Test resource cleanup failed; operator inspection is required.' >&2
  fi
  return "$cleanup_failed"
}
if [ "${1:-}" = cleanup ]; then cleanup after-script; exit $?; fi
case "${1:-}" in all|gitlab|sync|gitlab-runner|bootstrapper|nginx|wizard|shared|performance) component="$1";;
  *) echo 'Select a documented isolated component.' >&2; exit 2;; esac
case "${CI_COMMIT_SHA:-}" in ''|*[!0-9a-f]*) echo 'The expected CI_COMMIT_SHA is required.' >&2; exit 2;; esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || { echo 'The expected CI_COMMIT_SHA must be a full commit ID.' >&2; exit 2; }
expected_revision=$(cat .test-context/revision)
[ "$expected_revision" = "$CI_COMMIT_SHA" ] || { echo 'The test context is stale for this commit.' >&2; exit 1; }
context_hash=$(cat .test-context/sha256)
case "$context_hash" in ''|*[!0-9a-f]*) echo 'Invalid test-context checksum.' >&2; exit 1;; esac
[ "${#context_hash}" -eq 64 ] || { echo 'Invalid test-context checksum length.' >&2; exit 1; }
printf '%s  %s\n' "$context_hash" .test-context/context.tar | sha256sum -c -
on_exit() {
  primary_status=$?
  trap - EXIT INT TERM
  cleanup_status=0
  cleanup on-exit || cleanup_status=$?
  if [ "$primary_status" -eq 0 ] && [ "$cleanup_status" -ne 0 ]; then primary_status=$cleanup_status; fi
  exit "$primary_status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p test-results

docker build --label "org.system-bootstrapper.test-job=$CI_JOB_ID" -f tests/Dockerfile -t "$image" - < .test-context/context.tar
docker create --name "$resource" --label "org.system-bootstrapper.test-job=$CI_JOB_ID" \
  --init --network none --memory 2g --cpus 2 --pids-limit 512 "$image" "$component" >/dev/null
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
