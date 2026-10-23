#!/bin/sh
# Shared by the standalone base and the complete System image build.
set -eu
test "$(node --version)" = v24.22.0
test "$(npm --version)" = 11.19.1
apk add --no-cache \
  docker-cli=29.9.2-r0 \
  docker-cli-compose=5.6.1-r0 \
  docker-cli-buildx=0.38.1-r0 \
  rsync=3.5.0-r0 \
  bash=5.3.9-r1 \
  git=2.54.0-r0 \
  unzip=6.0-r16 \
  curl=8.22.0-r0 \
  zlib=1.3.2-r1
docker --version
docker-compose --version
docker compose version
docker buildx version
