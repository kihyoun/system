#!/usr/bin/env bash
# Opt-in setup for the local-only test instance, not a production registry.
set -euo pipefail
if (( EUID != 0 )); then
    echo "Run with sudo: bash bootstrapper/prepare-local.sh" >&2
    exit 1
fi
install -d -m 0755 /etc/docker
python3 - <<'PY'
import json
from pathlib import Path

config = Path('/etc/docker/daemon.json')
settings = json.loads(config.read_text()) if config.exists() else {}
registries = settings.setdefault('insecure-registries', [])
if 'registry.localhost:5050' not in registries:
    registries.append('registry.localhost:5050')
Path('/etc/docker/daemon.json.bootstrapper.tmp').write_text(json.dumps(settings, indent=2) + '\n')
PY
dockerd --validate --config-file /etc/docker/daemon.json.bootstrapper.tmp
mv /etc/docker/daemon.json.bootstrapper.tmp /etc/docker/daemon.json
systemctl reload docker

python3 - <<'PY'
from pathlib import Path
hosts = Path('/etc/hosts')
text = hosts.read_text()
names = {name for line in text.splitlines() for name in line.split('#')[0].split()[1:]}
for name in ('gitlab.localhost', 'registry.localhost', 'sync.localhost'):
    if name not in names:
        text += '\n127.0.0.1 ' + name
hosts.write_text(text.rstrip() + '\n')
PY
echo "Local registry and hostnames configured."
