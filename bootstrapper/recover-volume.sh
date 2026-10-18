#!/usr/bin/env bash
# Run from the retained volume, after mounting it and installing Docker/Certbot.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
: "${PERSISTENCE_ENV_FILE:?Set PERSISTENCE_ENV_FILE to the retained recovery/persistence.env}"
set -a
source "$PERSISTENCE_ENV_FILE"
set +a
bash bootstrapper/persistence.sh
recovery="$PERSISTENT_DIR/recovery"
python3 - "$recovery" <<'PYVERIFY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'images.json').read_text())
for archive in manifest['archives']:
    filename = root / archive['file']
    if filename.resolve().parent != (root / 'images').resolve():
        raise SystemExit('Unexpected image archive path')
    digest = hashlib.file_digest(filename.open('rb'), 'sha256').hexdigest()
    if digest != archive['sha256']:
        raise SystemExit('Image archive checksum mismatch')
print('Recovery archive checksums verified.')
PYVERIFY
if [[ ${1:-} == --verify ]]; then exit 0; fi
[[ $# == 0 ]] || { echo 'Usage: recover-volume.sh [--verify]' >&2; exit 1; }
install -d -m 0700 /etc/system-bootstrapper
if [[ $(realpath "$PERSISTENCE_ENV_FILE") != /etc/system-bootstrapper/persistence.env ]]; then
    install -m 0600 "$PERSISTENCE_ENV_FILE" /etc/system-bootstrapper/persistence.env
fi
export PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env
python3 - "$recovery" <<'PYIMAGES'
import json, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1]); manifest = json.loads((root / 'images.json').read_text())
for archive in manifest['archives']:
    # Stream decompression; avoid a large temporary tar on the VM root disk.
    unpack = subprocess.Popen(['gzip', '-dc', str(root / archive['file'])], stdout=subprocess.PIPE)
    loaded = subprocess.run(['docker', 'load'], stdin=unpack.stdout)
    unpack.stdout.close()
    if unpack.wait() or loaded.returncode: raise SystemExit('Cannot load recovery image archive')
for image in manifest['publicImages']:
    if subprocess.run(['docker', 'image', 'inspect', image['reference']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(['docker', 'pull', image['reference']], check=True)
    subprocess.run(['docker', 'tag', image['reference'], image['tag']], check=True)
PYIMAGES
bash bootstrapper/install-volume-host.sh
export SYSTEM_BOOTSTRAPPER_SKIP_BUILD=1
bash start.sh
