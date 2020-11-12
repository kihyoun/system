#! /bin/bash
if [ -f .docker.env ]; then
    source .docker.env
else
    source .docker.env.example
    source .seed.env
fi

cd ../gitlab-runner; bash stop.sh
cd ../nginx-proxy; bash stop.sh
cd ../gitlab; bash stop.sh
cd ../nginx; bash stop.sh
