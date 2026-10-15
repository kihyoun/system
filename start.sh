#! /bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -f system/.docker.env ]; then
    source system/.docker.env
else
    source system/.docker.env.example
    source system/.seed.env
fi

docker-compose -p system -f system/docker-compose.yml up --build -d bootstrapper
