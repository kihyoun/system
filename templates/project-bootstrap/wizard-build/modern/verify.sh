#!/bin/sh
set -eu
test -n "$WIZARD_IMAGE_REF"
network="wizard-check-$CI_PROJECT_ID-$CI_JOB_ID"
candidate="$network-app"
browser="$network-browser"
browser_image="$network-browser-image"
builder="$network-builder"
. .system-bootstrapper/build-v1/cleanup.sh
trap wizard_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p browser-evidence
echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
docker pull "$WIZARD_IMAGE_REF"
docker buildx create --name "$builder" --driver docker-container --driver-opt memory=4g --driver-opt cpu-period=100000 --driver-opt cpu-quota=200000 --driver-opt image=moby/buildkit:buildx-stable-1@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea
docker buildx build --builder "$builder" --load --provenance=false -f .system-bootstrapper/build-v1/Browser.Dockerfile -t "$browser_image" .
docker network create --internal "$network"
docker run -d --memory 128m --cpus 0.5 --name "$candidate" --network "$network" --network-alias wizard-candidate "$WIZARD_IMAGE_REF"
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$candidate" wget -q -O /dev/null http://127.0.0.1/; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
docker run --memory 1g --cpus 1 --name "$browser" --network "$network" --shm-size 256m "$browser_image"
docker cp "$browser:/evidence/." browser-evidence/
test -f browser-evidence/browser.json
printf '{"version":1,"sourceCommit":"%s","pipelineId":%s,"imageRef":"%s","http":true,"renderedUI":true,"projects":true,"spa":true,"configurationBackup":true,"cubeSignature":true}\n' "$CI_COMMIT_SHA" "$CI_PIPELINE_ID" "$WIZARD_IMAGE_REF" > wizard-evidence.json
