#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run this script as root: sudo bash bootstrapper/install.sh" >&2
  exit 1
fi

source /etc/os-release
if [[ "$ID" != ubuntu ]]; then
  echo "This installer supports Ubuntu." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y zsh unzip git ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Legacy orchestration scripts require underscore-separated container names.
# Keep their command available while using the maintained Compose plugin.
cat > /usr/local/bin/docker-compose <<'EOF'
#!/bin/sh
exec docker compose --compatibility "$@"
EOF
chmod 0755 /usr/local/bin/docker-compose

systemctl enable --now docker
docker version
docker-compose version
docker run --rm hello-world
