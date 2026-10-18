#!/bin/sh
# Shared by the standalone base and the complete System image build.
set -eu
test "$(node --version)" = v24.22.0
test "$(npm --version)" = 11.19.1
apk add --no-cache \
  docker-cli=29.8.2-r1 \
  docker-cli-compose=5.1.4-r2 \
  docker-cli-buildx=0.34.1-r2 \
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
