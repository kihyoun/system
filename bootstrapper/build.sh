#! /bin/bash
docker build -t systembootstrapper/system:latest \
    -v /var/run/docker.sock:/var/run/docker.sock
    -v /run/snapd.socket:/run/snapd.socket