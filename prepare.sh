#!/bin/bash
[ ! -d system ] && git clone https://github.com/kihyoun/system.git
if [ -d system ]; then
        cd system;
else
        echo "System not found. Please create a .docker.env"
fi

