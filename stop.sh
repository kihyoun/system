#! /bin/bash
if [ -f system/.docker.env ]; then
    source system/.docker.env
else
    source system/.docker.env.example
    source system/.seed.env
fi

docker exec -it system_bootstrapper_1 /system/system/stop.sh
docker-compose -f system/docker-compose.yml down
