#! /bin/bash
cd ../gitlab; bash ./start.sh;
cd ../nginx-proxy; bash ./start.sh;
cd ../gitlab-runner; bash ./start.sh;
cd ../wizard; bash ./start.sh;