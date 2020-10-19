#! /bin/bash
(cd gitlab; ./stop.sh)
(cd nginx-proxy; ./stop.sh)
(cd nginx; ./stop.sh)

docker volume prune -f
docker system prune -f