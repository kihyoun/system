#!/bin/sh
set -eu
case "${1:-}:${2:-}" in deploy:review|stop:review|deploy:beta|stop:beta) ;; *) exit 2;; esac
# Values are instance configuration, never source-controlled ownership markers.
helper_image=${SYSTEM_WIZARD_ENVIRONMENT_IMAGE:-}
operation=${SYSTEM_WIZARD_ENVIRONMENT_OPERATION:-}
printf '%s\n' "$helper_image" | grep -Eq '^sha256:[a-f0-9]{64}$' || exit 2
printf '%s\n' "$operation" | grep -Eq '^[a-f0-9]{48}$' || exit 2
for identity in "${CI_PROJECT_ID:-}" "${CI_PIPELINE_ID:-}" "${CI_JOB_ID:-}"; do
  printf '%s\n' "$identity" | grep -Eq '^[1-9][0-9]*$' || exit 2
done
printf '%s\n' "${CI_COMMIT_SHA:-}" | grep -Eq '^[a-f0-9]{40}$' || exit 2
case "$2" in
  review) printf '%s\n' "${CI_MERGE_REQUEST_IID:-}" | grep -Eq '^[1-9][0-9]*$' || exit 2;;
  beta) [ "${CI_MERGE_REQUEST_IID:-0}" = 0 ] || exit 2;;
esac
helper="wizard-environment-$CI_PROJECT_ID-$CI_JOB_ID"
# The clean immutable helper must already be provisioned on this runner daemon.
docker image inspect "$helper_image" >/dev/null
helper_id=
registry_config=$(mktemp -d)
cleanup() {
  rm -rf "$registry_config"
  [ -n "$helper_id" ] || return 0
  identity=$(timeout 15 docker container inspect --format '{{.Id}} {{.Image}} {{index .Config.Labels "system.wizard.environments.helper"}}' "$helper_id" 2>/dev/null) || return 1
  [ "$identity" = "$helper_id $helper_image $operation" ] || return 1
  timeout 130 docker stop --time 120 "$helper_id" >/dev/null 2>&1 || return 1
  timeout 15 docker rm -f "$helper_id" >/dev/null 2>&1
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$1" = deploy ]; then
  # Standard job-scoped registry credentials stay in the CI job. The helper
  # independently chooses and verifies the digest through canonical GitLab.
  test -n "${WIZARD_IMAGE_REF:-}"
  case "$WIZARD_IMAGE_REF" in "$CI_REGISTRY_IMAGE"@sha256:*) ;; *) exit 2;; esac
  printf '%s\n' "$CI_REGISTRY_PASSWORD" | docker --config "$registry_config" login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  docker --config "$registry_config" pull "$WIZARD_IMAGE_REF"
fi
helper_id=$(docker create --name "$helper" --network none --read-only \
  --memory 256m --cpus 1 --pids-limit 128 --tmpfs /tmp:rw,nosuid,noexec,size=16m \
  --label "system.wizard.environments.helper=$operation" \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount type=volume,source=system_templates,target=/templates \
  --mount type=volume,source=system_ssl,target=/ssl,readonly \
  --entrypoint node "$helper_image" /system/project-bootstrap/wizard-environments/helper.js \
  --action "$1" --kind "$2" --project "$CI_PROJECT_ID" --pipeline "$CI_PIPELINE_ID" \
  --job "$CI_JOB_ID" --sha "$CI_COMMIT_SHA" --mr "${CI_MERGE_REQUEST_IID:-0}" \
  --operation "$operation" --controller system_bootstrapper_1)
case "$helper_id" in *[!0-9a-f]*|'') exit 2;; esac
[ "${#helper_id}" -eq 64 ] || exit 2
docker start --attach "$helper_id"
