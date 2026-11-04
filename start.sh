#! /bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

storage_env=${PERSISTENCE_ENV_FILE:-/etc/system-bootstrapper/persistence.env}
if [[ -f $storage_env ]]; then
    set -a
    source "$storage_env"
    set +a
fi
host_seed_set=${SEED_DIR+x}
host_seed=${SEED_DIR:-}
host_seed_mount_set=${SEED_MOUNT+x}
host_seed_mount=${SEED_MOUNT:-}
host_seed_uuid_set=${SEED_UUID+x}
host_seed_uuid=${SEED_UUID:-}
source bootstrapper/storage-env.sh
export PERSISTENCE_MODE PERSISTENT_MOUNT PERSISTENT_DIR PERSISTENT_UUID
for operation_lock in "$PERSISTENT_DIR/configuration/.storage-operation-lock" "$PERSISTENT_DIR/configuration/.gitlab-upgrade-lock"; do
    if [[ -e $operation_lock || -L $operation_lock ]]; then
        printf 'An unfinished storage operation blocks startup.\n' >&2
        exit 1
    fi
done
bash bootstrapper/persistence.sh
readonly storage_mount=$PERSISTENT_MOUNT storage_dir=$PERSISTENT_DIR
readonly storage_uuid=${PERSISTENT_UUID:-}
readonly storage_mode=$PERSISTENCE_MODE

if [[ -f $storage_dir/configuration/.docker.env ]]; then
    source "$storage_dir/configuration/.docker.env"
elif [[ -f system/.docker.env ]]; then
    source system/.docker.env
else
    # Defaults must not replace the attached-volume seed selected by the host.
    bootstrapper_seed_set=${SEED_DIR+x}
    bootstrapper_seed_dir=${SEED_DIR-}
    source system/.docker.env.example
    source system/.seed.env
    if [[ $bootstrapper_seed_set ]]; then export SEED_DIR=$bootstrapper_seed_dir; fi
    unset bootstrapper_seed_set bootstrapper_seed_dir
fi
# Storage paths are selected by the host, not by a Wizard configuration upload.
export PERSISTENT_MOUNT=$storage_mount PERSISTENT_DIR=$storage_dir
export PERSISTENT_UUID=$storage_uuid
export PERSISTENCE_MODE=$storage_mode
if [[ $host_seed_set ]]; then export SEED_DIR=$host_seed; fi
if [[ $host_seed_mount_set ]]; then export SEED_MOUNT=$host_seed_mount; fi
if [[ $host_seed_uuid_set ]]; then export SEED_UUID=$host_seed_uuid; fi
bash bootstrapper/persistence.sh
# Backup media are validated and bound only by an explicit Seed operation.
export SEED_DIR=${SEED_DIR:-} SEED_MOUNT=${SEED_MOUNT:-} SEED_UUID=${SEED_UUID:-}

if [[ ${SYSTEM_BOOTSTRAPPER_SKIP_BUILD:-0} == 1 ]]; then
    docker-compose -p system -f system/docker-compose.yml up --no-build -d bootstrapper
else
    # Read pinned Git objects only when an image will actually be built.
    bash project-bootstrap/wizard-source/prepare.sh
    docker-compose -p system -f system/docker-compose.yml up --build -d bootstrapper
fi
