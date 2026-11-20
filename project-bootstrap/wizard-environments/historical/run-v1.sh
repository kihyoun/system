#!/bin/sh
set -eu
case "${1:-}:${2:-}" in deploy:review|stop:review|deploy:beta|stop:beta) ;; *) exit 2;; esac
helper_image='__HELPER_IMAGE__'
helper="wizard-environment-$CI_PROJECT_ID-$CI_JOB_ID"
# The clean immutable helper must already be provisioned on this runner daemon.
docker image inspect "$helper_image" >/dev/null
if [ "$1" = deploy ]; then
  # Standard job-scoped registry credentials stay in the CI job. The helper
  # independently chooses and verifies the digest through canonical GitLab.
  test -n "${WIZARD_IMAGE_REF:-}"
  case "$WIZARD_IMAGE_REF" in "$CI_REGISTRY_IMAGE"@sha256:*) ;; *) exit 2;; esac
  echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  docker pull "$WIZARD_IMAGE_REF"
fi
helper_id=
cleanup() {
  [ -n "$helper_id" ] || return 0
  # Never clean a name whose creation failed or a foreign occupied resource.
  identity=$(timeout 15 docker container inspect --format '{{.Id}} {{.Image}} {{index .Config.Labels "system.wizard.environments.helper"}}' "$helper_id" 2>/dev/null) || return 1
  [ "$identity" = "$helper_id $helper_image __OPERATION__" ] || return 1
  timeout 130 docker stop --time 120 "$helper_id" >/dev/null 2>&1 || return 1
  timeout 15 docker rm -f "$helper_id" >/dev/null 2>&1
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
helper_id=$(docker create --name "$helper" --network none --read-only \
  --memory 256m --cpus 1 --pids-limit 128 --tmpfs /tmp:rw,nosuid,noexec,size=16m \
  --label system.wizard.environments.helper=__OPERATION__ \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount type=volume,source=system_templates,target=/templates \
  --mount type=volume,source=system_ssl,target=/ssl,readonly \
  --entrypoint node "$helper_image" /system/project-bootstrap/wizard-environments/helper.js \
  --action "$1" --kind "$2" --project "$CI_PROJECT_ID" --pipeline "$CI_PIPELINE_ID" \
  --job "$CI_JOB_ID" --sha "$CI_COMMIT_SHA" --mr "${CI_MERGE_REQUEST_IID:-0}" \
  --operation '__OPERATION__' --controller system_bootstrapper_1)
case "$helper_id" in *[!0-9a-f]*|'') exit 2;; esac
[ "${#helper_id}" -eq 64 ] || exit 2
docker start --attach "$helper_id"
