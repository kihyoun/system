#!/bin/bash

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install zsh unzip git apt-transport-https \
    ca-certificates \
    curl \
    gnupg-agent \
    software-properties-common -y
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo apt-key fingerprint 0EBFCD88
sudo add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io -y
sudo curl -L "https://github.com/docker/compose/releases/download/1.27.4/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
sudo docker-compose --version

shopt -s dotglob
[ ! -d system ] && git clone https://github.com/kihyoun/system.git
[ -d system ] && [ -f bootstrapper.zip ] && unzip bootstrapper.zip -d ./system/
if [ -d system ]; then
        (cd system; 
	[ -d bootstrapper ] && mv bootstrapper/.projects.env/.*.env .projects.env
	[ -d bootstrapper ] && mv bootstrapper/.projects.env/*.env .projects.env
	[ -d bootstrapper ] && mv bootstrapper/* .
	[ -d bootstrapper ] && rm -fr bootstrapper
	if [ -f .docker.env ]; then
		source .docker.env
		rsync -av --progress $BACKUPDIR/srv/ $LIVEDIR
		mkdir -p /etc/letsencrypt
		rsync -av --progress $BACKUPDIR/letsencrypt/ /etc/letsencrypt
		./start.sh
	fi
	)
	echo 'Ready to deploy.'
else
        echo "System not found."
fi
