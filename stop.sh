#! /bin/bash
(cd nginx; ./stop.sh)
(cd gitlab-runner; ./stop.sh)
(cd gitlab; ./stop.sh)
(cd nginx-proxy; ./stop.sh)
