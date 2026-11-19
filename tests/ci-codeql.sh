#!/bin/sh
# Trusted Docker parent; the static child receives only committed public source.
set -eu
umask 077
for value in "${CI_PROJECT_ID:-}" "${CI_JOB_ID:-}"; do
  case "$value" in ''|*[!0-9]*) echo 'Numeric CI project/job identities required.' >&2; exit 2;; esac
done
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
resource="system-codeql-${CI_PROJECT_ID}-${CI_JOB_ID}"
image="system-codeql:ci-${CI_PROJECT_ID}-${CI_JOB_ID}"
label=org.system-bootstrapper.codeql-job
owner=$CI_PROJECT_ID:$CI_JOB_ID
report=test-results/codeql
temporary=
mkdir -p "$report"
cleanup() {
  failed=0
  if names=$(timeout 8 docker container ls --all --filter "name=^/${resource}$" --format '{{.Names}}' 2>/dev/null); then
    if [ -n "$names" ]; then
      identity=$(timeout 8 docker inspect --format "{{.Id}} {{index .Config.Labels \"$label\"}}" "$resource" 2>/dev/null) || identity=unknown
      id=${identity%% *}
      if [ "$names" != "$resource" ] || [ "$identity" != "$id $owner" ] ||
         ! timeout 8 docker rm --force "$id" >/dev/null 2>&1; then failed=1; fi
    fi
  else failed=1; fi
  if images=$(timeout 8 docker image ls --filter "reference=$image" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null); then
    if [ -n "$images" ]; then
      identity=$(timeout 8 docker image inspect --format "{{.Id}} {{index .Config.Labels \"$label\"}}" "$image" 2>/dev/null) || identity=unknown
      id=${identity%% *}
      if [ "$images" != "$image" ] || [ "$identity" != "$id $owner" ] ||
         ! timeout 8 docker image rm "$id" >/dev/null 2>&1; then failed=1; fi
    fi
  else failed=1; fi
  state=passed
  [ "$failed" -eq 0 ] || state=failed
  printf '{"status":"%s"}\n' "$state" > "$report/cleanup-$1.json"
  return "$failed"
}
if [ "${1:-}" = cleanup ]; then cleanup after-script; exit $?; fi
[ "$#" -eq 0 ] || exit 2
case "${CI_COMMIT_SHA:-}" in ''|*[!0-9a-f]*) echo 'Full source revision required.' >&2; exit 2;; esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || exit 2
[ "$(cat .codeql-context/revision)" = "$CI_COMMIT_SHA" ] || { echo 'Stale static context.' >&2; exit 1; }
checksum=$(cat .codeql-context/sha256)
case "$checksum" in ''|*[!0-9a-f]*) exit 2;; esac
[ "${#checksum}" -eq 64 ] || exit 2
printf '%s  %s\n' "$checksum" .codeql-context/context.tar | sha256sum --check -
on_exit() {
  primary=$?
  trap - EXIT INT TERM
  cleanup on-exit || { if [ "$primary" -eq 0 ]; then primary=1; fi; }
  if [ -n "$temporary" ]; then rm -rf -- "$temporary"; fi
  exit "$primary"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
temporary=$(mktemp -d)
# Empty client config prevents proxy/credential environment injection into child.
mkdir "$temporary/docker-config"
timeout 900 docker --config "$temporary/docker-config" build --label "$label=$owner" \
  -f source/tests/codeql/Dockerfile -t "$image" - < .codeql-context/context.tar
timeout 15 docker --config "$temporary/docker-config" create --name "$resource" --label "$label=$owner" \
  --init --user 1000:1000 --network none --memory 6g --memory-swap 6g --cpus 2 --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges "$image" >/dev/null
timeout 15 docker start "$resource" >/dev/null
wait_status=0
status=$(timeout 900 docker wait "$resource") || wait_status=$?
# Preserve available diagnostics before cleanup even when the client wait times
# out or loses its daemon connection. The primary failure remains authoritative.
log_status=0
timeout 15 docker logs "$resource" > "$report/scan.log" 2>&1 || log_status=$?
cat "$report/scan.log"
copy_failed=0
for file in tool.json results.sarif gate.json; do
  timeout 15 docker cp "$resource:/reports/$file" "$report/$file" 2>/dev/null || copy_failed=1
done
cp .codeql-context/manifest.json "$report/source.json"
if [ "$wait_status" -ne 0 ]; then exit "$wait_status"; fi
case "$status" in
  0) [ "$copy_failed" -eq 0 ] && [ "$log_status" -eq 0 ] || { echo 'Missing successful scan evidence.' >&2; exit 1; } ;;
  ''|*[!0-9]*) exit 1 ;;
  *) exit "$status" ;;
esac
