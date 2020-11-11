#! /bin/bash
if [ -f ../.docker.env ]; then
    source ../.docker.env
else
    source ../.docker.env.example
    source seed.env
fi

docker exec -it system_bootstrapper_1 /system/stop.sh
docker-compose down

docker system prune -f
docker network prune -f
docker volume prune -f
docker image prune -f
