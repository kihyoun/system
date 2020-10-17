#! /bin/bash
(cd gitlab; ./start.sh)
(cd nginx-proxy; ./start.sh)
(cd nginx; ./start.sh)

