#!/bin/bash
source install.sh
[ ! -d system ] && git clone https://github.com/kihyoun/system.git
if [ -d system ]; then
        cd system;
        ./start.sh
else
        echo "System not found."
fi

