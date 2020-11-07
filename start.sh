#! /bin/bash
shopt -s dotglob
if [ -f .docker.env ]; then
  source .docker.env
  (cd gitlab; ./start.sh)
  (cd nginx-proxy; ./start.sh)
  (cd nginx; ./start.sh)
  [ $ENABLE_SYNC = true ] && (cd sync; ./start.sh)
else
  echo "No .docker.env found. Starting synchronisation server..."
  (cd sync; ./start.sh)
fi

