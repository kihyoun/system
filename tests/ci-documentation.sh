#!/bin/sh
# Trusted native Docker parent; only public Git objects enter the isolated checker.
set -eu
umask 077
for value in "${CI_PROJECT_ID:-}" "${CI_JOB_ID:-}"; do
  case "$value" in ''|*[!0-9]*) echo 'Numeric CI project/job identities required.' >&2; exit 2;; esac
done
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
resource="system-documentation-${CI_PROJECT_ID}-${CI_JOB_ID}"
label=org.system-bootstrapper.documentation-job
report=test-results/documentation
temporary=
mkdir -p "$report"

cleanup() {
  failed=0
  if names=$(timeout 8 docker container ls --all --filter "name=^/${resource}$" --format '{{.Names}}' 2>/dev/null); then
    if [ -n "$names" ]; then
      identity=$(timeout 8 docker inspect --format "{{.Id}} {{index .Config.Labels \"$label\"}}" "$resource" 2>/dev/null) || identity=unknown
      id=${identity%% *}
      if [ "$names" != "$resource" ] || [ "$identity" != "$id $CI_PROJECT_ID:$CI_JOB_ID" ] ||
         ! timeout 8 docker rm --force "$id" >/dev/null 2>&1; then failed=1; fi
    fi
  else failed=1; fi
  state=passed
  [ "$failed" -eq 0 ] || state=failed
  printf '{"status":"%s"}\n' "$state" > "$report/cleanup-$1.json"
  return "$failed"
}
if [ "${1:-}" = cleanup ]; then cleanup after-script; exit $?; fi
[ "$#" -eq 0 ] || { echo 'Usage: ci-documentation.sh [cleanup]' >&2; exit 2; }
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
case "${CI_COMMIT_SHA:-}" in ''|*[!0-9a-f]*) echo 'Full source revision required.' >&2; exit 2;; esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || exit 2
git_source() { timeout 20 git --no-replace-objects -c core.hooksPath=/dev/null "$@"; }
[ "$(git_source rev-parse --verify 'HEAD^{commit}')" = "$CI_COMMIT_SHA" ] || { echo 'Checkout revision mismatch.' >&2; exit 1; }
base=
case "${CI_PIPELINE_SOURCE:-}" in
  merge_request_event) base=${CI_MERGE_REQUEST_DIFF_BASE_SHA:-} ;;
  push) base=${CI_COMMIT_BEFORE_SHA:-} ;;
  web|schedule) base=$(git_source rev-parse --verify HEAD^ 2>/dev/null) || base= ;;
  *) echo 'Supported CI pipeline source required.' >&2; exit 2 ;;
esac
if [ -n "$base" ]; then
  case "$base" in *[!0-9a-f]*) exit 2;; esac
  [ "${#base}" -eq 40 ] || exit 2
fi
if [ "$base" = 0000000000000000000000000000000000000000 ]; then
  [ "$CI_PIPELINE_SOURCE" = push ] || exit 2
  base=
elif [ -z "$base" ] && { [ "$CI_PIPELINE_SOURCE" = push ] || [ "$CI_PIPELINE_SOURCE" = merge_request_event ]; }; then
  echo 'Required diff base is missing.' >&2; exit 2
fi
temporary=$(mktemp -d)
mkdir "$temporary/candidate" "$temporary/docker-config"
# Export exactly the two snapshots' objects, never .git/config, remotes, hooks,
# alternates, credentials, dirty files or unrelated local refs/history.
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c init.templateDir= init -q "$temporary/candidate"
git_source rev-list --objects --no-object-names --no-walk "$CI_COMMIT_SHA" ${base:+"$base"} > "$temporary/object-ids"
git_source pack-objects --stdout < "$temporary/object-ids" > "$temporary/objects.pack"
timeout 20 git -C "$temporary/candidate" index-pack --stdin < "$temporary/objects.pack" >/dev/null
timeout 8 git -C "$temporary/candidate" update-ref HEAD "$CI_COMMIT_SHA"
timeout 8 git -C "$temporary/candidate" hash-object -w -t tree --stdin </dev/null >/dev/null
git_source show "$CI_COMMIT_SHA:gitlab/check-documentation.js" > "$temporary/candidate/checker.js"
chmod -R a+rX "$temporary/candidate"
chmod 0777 "$temporary/candidate"
image=node:24.22.0-bookworm@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0
timeout 45 docker pull "$image" >/dev/null
# An empty client config prevents automatic proxy/credential-bearing environment
# injection into the child. Pull uses the trusted parent's configured credentials.
timeout 10 docker --config "$temporary/docker-config" create --name "$resource" \
  --label "$label=$CI_PROJECT_ID:$CI_JOB_ID" \
  --init --user 1000:1000 --network none --memory 256m --cpus 1 --pids-limit 64 \
  --cap-drop ALL --security-opt no-new-privileges \
  --env "CI_PIPELINE_SOURCE=$CI_PIPELINE_SOURCE" --env "CI_COMMIT_SHA=$CI_COMMIT_SHA" \
  --env "CI_MERGE_REQUEST_DIFF_BASE_SHA=${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" \
  --env "CI_COMMIT_BEFORE_SHA=${CI_COMMIT_BEFORE_SHA:-}" \
  --env GIT_CONFIG_COUNT=1 --env GIT_CONFIG_KEY_0=safe.directory --env GIT_CONFIG_VALUE_0=/candidate \
  --workdir /candidate --entrypoint node "$image" /candidate/checker.js >/dev/null
timeout 10 docker cp "$temporary/candidate" "$resource:/"
timeout 8 docker start "$resource" >/dev/null
status=$(timeout 45 docker wait "$resource")
timeout 8 docker logs "$resource"
timeout 8 docker cp "$resource:/candidate/test-results/documentation/." "$report/"
case "$status" in 0) exit 0;; ''|*[!0-9]*) exit 1;; *) exit "$status";; esac
