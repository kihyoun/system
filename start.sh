#! /bin/bash
shopt -s dotglob
if [ -f .docker.env ]; then
  (cd gitlab; ./start.sh)
  (cd nginx-proxy; ./start.sh)
  (cd nginx; ./start.sh)
else
  echo "No .docker.env found!"
fi

