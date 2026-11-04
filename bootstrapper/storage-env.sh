#!/usr/bin/env bash
# Source before storage checks. Legacy explicit mount selectors remain volumes.
if [[ -z ${PERSISTENCE_MODE:-} ]]; then
    if [[ -n ${PERSISTENT_MOUNT:-} ]]; then PERSISTENCE_MODE=volume; else PERSISTENCE_MODE=local; fi
fi
if [[ $PERSISTENCE_MODE == local ]]; then
    PERSISTENT_MOUNT=${PERSISTENT_MOUNT:-/}
    PERSISTENT_DIR=${PERSISTENT_DIR:-/var/lib/system-bootstrapper/platform}
    PERSISTENT_UUID=${PERSISTENT_UUID:-}
fi
export PERSISTENCE_MODE PERSISTENT_MOUNT PERSISTENT_DIR PERSISTENT_UUID
export SEED_DIR=${SEED_DIR:-} SEED_MOUNT=${SEED_MOUNT:-} SEED_UUID=${SEED_UUID:-}
