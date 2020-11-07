#! /bin/bash
(cd gitlab; ./stop.sh)
(cd nginx-proxy; ./stop.sh)
(cd nginx; ./stop.sh)
