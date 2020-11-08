#! /bin/bash
source .docker.env
(cd gitlab-runner; bash stop.sh)
(cd nginx-proxy; bash stop.sh)
(cd gitlab; bash stop.sh)
(cd nginx; bash stop.sh)
