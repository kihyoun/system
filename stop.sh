#! /bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
if [ -f system/.docker.env ]; then
    source system/.docker.env
else
    source system/.docker.env.example
    source system/.seed.env
fi

if [ -n "$(docker-compose -p system -f system/docker-compose.yml ps -q --status running bootstrapper)" ]; then
    docker-compose -p system -f system/docker-compose.yml exec -T bootstrapper bash /system/system/stop.sh
fi
docker-compose -p system -f system/docker-compose.yml down
