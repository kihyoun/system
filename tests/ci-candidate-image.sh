#!/bin/sh
# Trusted parent: build the actual System image from the committed public context.
set -eu
case "${CI_PROJECT_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_PROJECT_ID required.' >&2; exit 2;; esac
case "${CI_JOB_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_JOB_ID required.' >&2; exit 2;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
resource="system-candidate-check-${CI_PROJECT_ID}-${CI_JOB_ID}"
image="system-candidate:ci-${CI_PROJECT_ID}-${CI_JOB_ID}"
report=test-results/candidate-image
mkdir -p "$report"
cleanup() {
  failed=0
  if names=$(timeout 8 docker container ls --all --filter "name=^/${resource}$" --format '{{.Names}}' 2>/dev/null); then
    if [ -n "$names" ]; then
      owner=$(timeout 8 docker inspect --format '{{index .Config.Labels "org.system-bootstrapper.test-job"}}' "$resource" 2>/dev/null) || owner=unknown
      if [ "$names" != "$resource" ] || [ "$owner" != "$CI_JOB_ID" ] || ! timeout 8 docker rm -f "$resource" >/dev/null 2>&1; then failed=1; fi
    fi
  else failed=1; fi
  if ids=$(timeout 8 docker image ls --filter "reference=$image" --format '{{.ID}}' 2>/dev/null); then
    if [ -n "$ids" ] && ! timeout 8 docker image rm "$image" >/dev/null 2>&1; then failed=1; fi
  else failed=1; fi
  printf '{"status":"%s"}\n' "$failed" > "$report/cleanup-$1.json"
  return "$failed"
}
if [ "${1:-}" = cleanup ]; then cleanup after-script; exit $?; fi
case "${CI_COMMIT_SHA:-}" in ''|*[!0-9a-f]*) echo 'Expected source revision required.' >&2; exit 2;; esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || exit 2
[ "$(cat .candidate-context/revision)" = "$CI_COMMIT_SHA" ] || { echo 'Stale candidate context.' >&2; exit 1; }
checksum=$(cat .candidate-context/sha256)
case "$checksum" in ''|*[!0-9a-f]*) exit 2;; esac
[ "${#checksum}" -eq 64 ] || exit 2
printf '%s  %s\n' "$checksum" .candidate-context/context.tar | sha256sum -c -
on_exit() {
  primary=$?
  trap - EXIT INT TERM
  cleanup on-exit || { if [ "$primary" -eq 0 ]; then primary=1; fi; }
  failure=''
  [ "$primary" -eq 0 ] || failure='<failure message="Candidate build or runtime validation failed; see job log"/>'
  printf '<?xml version="1.0"?><testsuite name="candidate-image" tests="1" failures="%s"><testcase name="full-system-build-and-runtime">%s</testcase></testsuite>\n' "$([ "$primary" -eq 0 ] && echo 0 || echo 1)" "$failure" > "$report/junit.xml"
  exit "$primary"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker build --label "org.system-bootstrapper.test-job=$CI_JOB_ID" -f system/Dockerfile -t "$image" - < .candidate-context/context.tar
image_id=$(docker image inspect --format '{{.Id}}' "$image")
printf '{"revision":"%s","imageId":"%s"}\n' "$CI_COMMIT_SHA" "$image_id" > "$report/image.json"
docker create --name "$resource" --label "org.system-bootstrapper.test-job=$CI_JOB_ID" \
  --init --network none --memory 1g --cpus 2 --pids-limit 128 --entrypoint /bin/sh "$image" -ec '
  cd /system/sync
  npm run lint
  npm run check
  test "$(node --version)" = v24.22.0
  test "$(npm --version)" = 11.19.1
  docker --version
  docker compose version
  cd /system
  node project-bootstrap/wizard-source/package.js --verify
  SEED_DIR=/candidate/seed PERSISTENT_DIR=/candidate/platform docker compose -p system -f system/docker-compose.yml config --quiet
' >/dev/null
docker start "$resource" >/dev/null
status=$(docker wait "$resource")
docker logs "$resource"
case "$status" in 0) exit 0;; ''|*[!0-9]*) exit 1;; *) exit "$status";; esac
