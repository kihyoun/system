#! /bin/bash
cd ../wizard; bash ./stop.sh;
cd ../gitlab-runner; bash stop.sh
cd ../nginx-proxy; bash stop.sh
cd ../gitlab; bash stop.sh
