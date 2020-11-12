#!/bin/bash
[ ! -d system ] && git clone https://github.com/kihyoun/system.git
if [ -d system ]; then
        cd system;
else
        echo "Error. System not found."
        exit 1
fi

