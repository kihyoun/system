#! /bin/bash
shopt -s dotglob
while [ true ]; do
  if [ -f .docker.env ]; then
    source .docker.env
    (cd gitlab; ./start.sh)
    (cd nginx-proxy; ./start.sh)
    (cd nginx; ./start.sh)
    [ $ENABLE_SYNC = true ] && (cd sync; ./start.sh)
    [ $ENABLE_SYNC = false ] && ./wait-for-it.sh 127.0.0.1:8071 -t 0
    ./stop.sh
  else
    echo "No .docker.env found. Starting synchronisation server..."
    (cd sync; ./start.sh)
  fi

done