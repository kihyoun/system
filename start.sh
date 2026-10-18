#! /bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -f system/.docker.env ]; then
    source system/.docker.env
else
    source system/.docker.env.example
    source system/.seed.env
fi

# Read pinned Git objects before the Docker context excludes Git metadata.
bash project-bootstrap/wizard-source/prepare.sh
docker-compose -p system -f system/docker-compose.yml up --build -d bootstrapper
