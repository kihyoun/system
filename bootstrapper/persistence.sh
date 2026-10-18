#!/usr/bin/env bash
# Host-side storage preflight; never source private configuration before this.
set -euo pipefail

fail() { printf 'Persistent storage: %s\n' "$*" >&2; exit 1; }
[[ $EUID == 0 ]] || fail 'run startup as root.'
: "${PERSISTENT_MOUNT:?Set PERSISTENT_MOUNT to the attached filesystem mountpoint}"
: "${PERSISTENT_DIR:?Set PERSISTENT_DIR beneath the attached filesystem}"
[[ $PERSISTENT_MOUNT == /* && $PERSISTENT_DIR == /* ]] || fail 'paths must be absolute.'
[[ $PERSISTENT_MOUNT != / ]] || fail 'the root filesystem is not persistent storage.'
[[ -d $PERSISTENT_MOUNT ]] || fail 'the configured mountpoint does not exist.'
mountpoint -q -- "$PERSISTENT_MOUNT" || fail 'the attached filesystem is not mounted.'
storage_mount=$(realpath -e -- "$PERSISTENT_MOUNT")
storage_dir=$(realpath -m -- "$PERSISTENT_DIR")
[[ $storage_dir == "$storage_mount/"* ]] || fail 'PERSISTENT_DIR must be beneath PERSISTENT_MOUNT.'
[[ $(findmnt -rn -o TARGET --target "$storage_mount") == "$storage_mount" ]] || fail 'mountpoint mismatch.'
[[ $(findmnt -rn -o MAJ:MIN --target "$storage_mount") != "$(findmnt -rn -o MAJ:MIN --target /)" ]] || fail 'storage resolves to the root filesystem.'
if [[ -n ${PERSISTENT_UUID:-} ]]; then
  [[ $(findmnt -rn -o UUID --target "$storage_mount") == "$PERSISTENT_UUID" ]] || fail 'filesystem UUID mismatch.'
fi
# Reject a nested mount or symlink escaping the checked filesystem.
existing=$storage_dir
while [[ ! -e $existing ]]; do existing=$(dirname -- "$existing"); done
[[ $(findmnt -rn -o TARGET --target "$existing") == "$storage_mount" ]] || fail 'data directory resolves to another filesystem.'
for relative in configuration templates synctemplates ssl runners gitlab/config gitlab/logs gitlab/data; do
  target=$(realpath -m -- "$storage_dir/$relative")
  [[ $target == "$storage_dir/"* ]] || fail "unsafe data path: $relative"
  if [[ -e $target ]]; then
    [[ -d $target && ! -L $storage_dir/$relative ]] || fail "unsafe data directory: $relative"
    [[ $(findmnt -rn -o TARGET --target "$target") == "$storage_mount" ]] || fail "data directory is another mount: $relative"
  fi
done
marker=$storage_dir/.system-bootstrapper-volume
if [[ -e $marker ]]; then
  [[ -f $marker && ! -L $marker ]] || fail 'invalid volume marker.'
  [[ $(cat -- "$marker") == system-bootstrapper-persistence-v1 ]] || fail 'unsupported volume marker.'
fi
umask 077
mkdir -p -- "$storage_dir" "$storage_dir/configuration" "$storage_dir/templates" \
  "$storage_dir/synctemplates" "$storage_dir/ssl" "$storage_dir/runners" "$storage_dir/gitlab/config" \
  "$storage_dir/gitlab/logs" "$storage_dir/gitlab/data"
chmod 0700 -- "$storage_dir/configuration"
printf '%s\n' system-bootstrapper-persistence-v1 > "$marker"
printf 'Persistent storage verified: %s\n' "$storage_dir"
