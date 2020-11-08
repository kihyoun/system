#! /bin/bash
source .docker.env
(cd gitlab-runner; ./stop.sh)
(cd nginx-proxy; ./stop.sh)
