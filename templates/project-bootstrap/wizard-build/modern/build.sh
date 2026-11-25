#!/bin/sh
set -eu
test -z "${SYSTEM_WIZARD_EXPECTED_SHA:-}" || test "$CI_COMMIT_SHA" = "$SYSTEM_WIZARD_EXPECTED_SHA"
echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
image="$CI_REGISTRY_IMAGE:wizard-$CI_COMMIT_SHA-$CI_PIPELINE_ID"
builder="wizard-build-$CI_PROJECT_ID-$CI_JOB_ID"
. .system-bootstrapper/build-v1/cleanup.sh
trap wizard_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker buildx create --name "$builder" --driver docker-container --driver-opt memory=4g --driver-opt cpu-period=100000 --driver-opt cpu-quota=200000 --driver-opt image=moby/buildkit:buildx-stable-1@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea
docker buildx build --builder "$builder" --load --provenance=false --label "org.opencontainers.image.revision=$CI_COMMIT_SHA" -f .system-bootstrapper/build-v1/Dockerfile -t "$image" .
docker push "$image"
ref=$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -F "$CI_REGISTRY_IMAGE@sha256:" | head -n 1)
digest=${ref#"$CI_REGISTRY_IMAGE@sha256:"}
test "$ref" = "$CI_REGISTRY_IMAGE@sha256:$digest"
test "${#digest}" -eq 64
case "$digest" in *[!0-9a-f]*|'') echo 'Registry digest unavailable' >&2; exit 1;; esac
printf 'WIZARD_IMAGE_REF=%s\n' "$ref" > image.env
printf '{"version":1,"sourceCommit":"%s","pipelineId":%s,"imageRef":"%s","unitTests":true,"testRunner":"vitest","lint":true,"typecheck":true,"productionBuild":true}\n' "$CI_COMMIT_SHA" "$CI_PIPELINE_ID" "$ref" > build-evidence.json
