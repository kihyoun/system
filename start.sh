#! /bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

storage_env=${PERSISTENCE_ENV_FILE:-/etc/system-bootstrapper/persistence.env}
if [[ -f $storage_env ]]; then source "$storage_env"; fi
export PERSISTENT_MOUNT PERSISTENT_DIR PERSISTENT_UUID
bash bootstrapper/persistence.sh
readonly storage_mount=$PERSISTENT_MOUNT storage_dir=$PERSISTENT_DIR
readonly storage_uuid=${PERSISTENT_UUID:-}

if [[ -f $storage_dir/configuration/.docker.env ]]; then
    source "$storage_dir/configuration/.docker.env"
elif [[ -f system/.docker.env ]]; then
    source system/.docker.env
else
    source system/.docker.env.example
    source system/.seed.env
fi
# Storage paths are selected by the host, not by a Wizard configuration upload.
export PERSISTENT_MOUNT=$storage_mount PERSISTENT_DIR=$storage_dir
export PERSISTENT_UUID=$storage_uuid
bash bootstrapper/persistence.sh
: "${SEED_DIR:?SEED_DIR must be set}"
seed_path=$(realpath -m -- "$SEED_DIR")
[[ $seed_path == "$storage_mount/"* && $seed_path != "$storage_dir" &&
   $seed_path != "$storage_dir/"* && $storage_dir != "$seed_path/"* ]] || {
    echo 'SEED_DIR must be beneath PERSISTENT_MOUNT and separate from the live data directory.' >&2
    exit 1
}
mkdir -p -- "$seed_path"
[[ $(findmnt -rn -o TARGET --target "$seed_path") == "$(realpath -e -- "$storage_mount")" ]] || {
    echo 'SEED_DIR resolves to another filesystem.' >&2
    exit 1
}
export SEED_DIR=$seed_path

if [[ ${SYSTEM_BOOTSTRAPPER_SKIP_BUILD:-0} == 1 ]]; then
    docker-compose -p system -f system/docker-compose.yml up --no-build -d bootstrapper
else
    # Read pinned Git objects only when an image will actually be built.
    bash project-bootstrap/wizard-source/prepare.sh
    docker-compose -p system -f system/docker-compose.yml up --build -d bootstrapper
fi
