#!/bin/sh
# Trusted Docker parent. The browser child has no host mounts or job credentials.
set -eu
case "${CI_PROJECT_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_PROJECT_ID required.' >&2; exit 2;; esac
case "${CI_JOB_ID:-}" in ''|*[!0-9]*) echo 'Numeric CI_JOB_ID required.' >&2; exit 2;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
resource="system-wizard-browser-${CI_PROJECT_ID}-${CI_JOB_ID}"
image="system-wizard-browser:ci-${CI_PROJECT_ID}-${CI_JOB_ID}"
report=test-results/wizard-browser
mkdir -p "$report"
cleanup() {
  failed=0
  if names=$(timeout 8 docker container ls --all --filter "name=^/${resource}$" --format '{{.Names}}' 2>/dev/null); then
    if [ -n "$names" ]; then
      identity=$(timeout 8 docker inspect --format '{{.Id}}|{{index .Config.Labels "org.system-bootstrapper.test-project"}}|{{index .Config.Labels "org.system-bootstrapper.test-job"}}|{{index .Config.Labels "org.system-bootstrapper.test-kind"}}' "$resource" 2>/dev/null) || identity=unknown
      id=${identity%%|*}
      case "$id" in ''|*[!0-9a-f]*) id=invalid;; esac
      if [ "$names" != "$resource" ] || [ "${#id}" -ne 64 ] || [ "$identity" != "$id|$CI_PROJECT_ID|$CI_JOB_ID|wizard-browser" ] || ! timeout 8 docker rm -f "$id" >/dev/null 2>&1; then failed=1; fi
    fi
  else failed=1; fi
  if names=$(timeout 8 docker image ls --filter "reference=$image" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null); then
    if [ -n "$names" ]; then
      identity=$(timeout 8 docker image inspect --format '{{.Id}}|{{index .Config.Labels "org.system-bootstrapper.test-project"}}|{{index .Config.Labels "org.system-bootstrapper.test-job"}}|{{index .Config.Labels "org.system-bootstrapper.test-kind"}}' "$image" 2>/dev/null) || identity=unknown
      id=${identity%%|*}
      digest=${id#sha256:}
      case "$digest" in ''|*[!0-9a-f]*) digest=invalid;; esac
      if [ "$names" != "$image" ] || [ "$id" != "sha256:$digest" ] || [ "${#digest}" -ne 64 ] || [ "$identity" != "$id|$CI_PROJECT_ID|$CI_JOB_ID|wizard-browser" ] || ! timeout 8 docker image rm "$id" >/dev/null 2>&1; then failed=1; fi
    fi
  else failed=1; fi
  state=passed
  [ "$failed" -eq 0 ] || { state=failed; echo 'Wizard browser owned-resource cleanup failed.' >&2; }
  printf '{"container":"%s","image":"%s","status":"%s"}\n' "$resource" "$image" "$state" > "$report/cleanup-$1.json" || failed=1
  return "$failed"
}
if [ "${1:-}" = cleanup ]; then cleanup after-script; exit $?; fi
[ "$#" -eq 0 ] || { echo 'Unexpected browser-check argument.' >&2; exit 2; }
case "${CI_COMMIT_SHA:-}" in ''|*[!0-9a-f]*) echo 'Expected source revision required.' >&2; exit 2;; esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || exit 2
[ "$(cat .wizard-browser-context/revision)" = "$CI_COMMIT_SHA" ] || { echo 'Stale Wizard browser context.' >&2; exit 1; }
checksum=$(cat .wizard-browser-context/sha256)
case "$checksum" in ''|*[!0-9a-f]*) exit 2;; esac
[ "${#checksum}" -eq 64 ] || exit 2
printf '%s  %s\n' "$checksum" .wizard-browser-context/context.tar | sha256sum -c -
on_exit() {
  primary=$?
  trap - EXIT INT TERM
  cleanup on-exit || { if [ "$primary" -eq 0 ]; then primary=1; fi; }
  [ -z "${client_config:-}" ] || rm -rf "$client_config"
  # Preserve Playwright's detailed report; provide a JUnit result for build/start failures.
  if [ ! -s "$report/junit.xml" ]; then
    printf '<?xml version="1.0"?><testsuite name="wizard-browser" tests="1" failures="1"><testcase name="full-native-browser-suite"><failure message="Browser build, launch, report copy or execution failed; see job log"/></testcase></testsuite>\n' > "$report/junit.xml"
    [ "$primary" -ne 0 ] || primary=1
  fi
  exit "$primary"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Refuse collisions before building; never replace a foreign tag or container.
existing=$(timeout 8 docker container ls --all --filter "name=^/${resource}$" --format '{{.Names}}')
[ -z "$existing" ] || { echo 'Browser container name already exists.' >&2; exit 1; }
existing=$(timeout 8 docker image ls --filter "reference=$image" --format '{{.Repository}}:{{.Tag}}')
[ -z "$existing" ] || { echo 'Browser image tag already exists.' >&2; exit 1; }
# An empty client config prevents Docker from injecting configured proxy env vars.
client_config=$(mktemp -d)
printf '{}\n' > "$client_config/config.json"
timeout -k 10 480 docker build --label "org.system-bootstrapper.test-project=$CI_PROJECT_ID" \
  --label "org.system-bootstrapper.test-job=$CI_JOB_ID" --label org.system-bootstrapper.test-kind=wizard-browser \
  -f tests/wizard-browser.Dockerfile -t "$image" - < .wizard-browser-context/context.tar
timeout 15 docker --config "$client_config" create --name "$resource" \
  --label "org.system-bootstrapper.test-project=$CI_PROJECT_ID" --label "org.system-bootstrapper.test-job=$CI_JOB_ID" \
  --label org.system-bootstrapper.test-kind=wizard-browser \
  --init --network none --memory 2g --cpus 2 --pids-limit 512 "$image" >/dev/null
timeout 15 docker start "$resource" >/dev/null
status=0
child_status=$(timeout -k 10 240 docker wait "$resource") || status=$?
if [ "$status" -eq 0 ]; then
  case "$child_status" in ''|*[!0-9]*) status=1;; *) status=$child_status;; esac
fi
timeout 15 docker logs "$resource" || { if [ "$status" -eq 0 ]; then status=1; fi; }
# Reports leave through Docker cp, including when the suite fails or times out.
timeout 20 docker cp "$resource:/candidate/test-results/wizard-browser/." "$report/" || { if [ "$status" -eq 0 ]; then status=1; fi; }
exit "$status"
