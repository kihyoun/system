#! /bin/bash
shopt -s dotglob
while [ true ]; do
  if [ -f .docker.env ]; then
    source .docker.env
    (cd gitlab; bash ./start.sh)
    (cd nginx-proxy; bash ./start.sh)
    (cd nginx; bash ./start.sh)
    [ $SYNC_ENABLE = true ] && (cd sync; bash ./start.sh)
    [ $SYNC_ENABLE = false ] && ./wait-for-it.sh 127.0.0.1:8071 -t 0
    bash ./stop.sh
  else
    echo "No .docker.env found. Starting synchronisation server..."
    (cd sync; bash ./start.sh)
  fi

done