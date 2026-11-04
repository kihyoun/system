#!/usr/bin/env bash
# Host-side storage preflight; never source private configuration before this.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/storage-env.sh"

fail() { printf 'Persistent storage: %s\n' "$*" >&2; exit 1; }
[[ $EUID == 0 ]] || fail 'run startup as root.'
: "${PERSISTENT_MOUNT:?Set PERSISTENT_MOUNT to the attached filesystem mountpoint}"
: "${PERSISTENT_DIR:?Set PERSISTENT_DIR beneath the attached filesystem}"
[[ $PERSISTENT_MOUNT == /* && $PERSISTENT_DIR == /* ]] || fail 'paths must be absolute.'
[[ $PERSISTENCE_MODE == local || $PERSISTENCE_MODE == volume ]] || fail 'PERSISTENCE_MODE must be local or volume.'
[[ $PERSISTENCE_MODE == local || $PERSISTENT_MOUNT != / ]] || fail 'the root filesystem requires explicit local mode.'
[[ -d $PERSISTENT_MOUNT ]] || fail 'the configured mountpoint does not exist.'
mountpoint -q -- "$PERSISTENT_MOUNT" || fail 'the attached filesystem is not mounted.'
storage_mount=$(realpath -e -- "$PERSISTENT_MOUNT")
storage_dir=$(realpath -m -- "$PERSISTENT_DIR")
[[ $storage_dir != / && $storage_dir == "${storage_mount%/}/"* ]] || fail 'PERSISTENT_DIR must be beneath PERSISTENT_MOUNT.'
[[ $(findmnt -rn -o TARGET --target "$storage_mount") == "$storage_mount" ]] || fail 'mountpoint mismatch.'
if [[ $PERSISTENCE_MODE == volume ]]; then
  [[ $(findmnt -rn -o MAJ:MIN --target "$storage_mount") != "$(findmnt -rn -o MAJ:MIN --target /)" ]] || fail 'storage resolves to the root filesystem.'
else
  [[ $storage_mount == / ]] || fail 'local mode must select the system filesystem.'
fi
if [[ -n ${PERSISTENT_UUID:-} ]]; then
  [[ $(findmnt -rn -o UUID --target "$storage_mount") == "$PERSISTENT_UUID" ]] || fail 'filesystem UUID mismatch.'
fi
# Reject a nested mount or symlink escaping the checked filesystem.
existing=$storage_dir
while [[ ! -e $existing ]]; do existing=$(dirname -- "$existing"); done
[[ $(findmnt -rn -o TARGET --target "$existing") == "$storage_mount" ]] || fail 'data directory resolves to another filesystem.'
[[ $(realpath -m -- "$PERSISTENT_DIR") == "${PERSISTENT_DIR%/}" ]] || fail 'live data path must be canonical.'
case $(stat -f -c %T -- "$existing") in
  msdos|vfat|9p|drvfs|fuseblk) fail 'live data requires a POSIX filesystem; use the Linux filesystem in WSL.' ;;
esac
minimum=${PERSISTENCE_MIN_FREE_BYTES:-1073741824}
[[ $minimum =~ ^[0-9]+$ ]] || fail 'invalid free-space requirement.'
available=$(df -B1 --output=avail -- "$existing" | tail -n 1 | tr -d ' ')
(( available >= minimum )) || fail 'insufficient free space for live data.'
[[ -w $existing && -x $existing ]] || fail 'live data parent must be writable.'
for relative in configuration wizard-public templates synctemplates ssl ssl/acme-http01 runners host/letsencrypt gitlab/config gitlab/logs gitlab/data; do
  target=$(realpath -m -- "$storage_dir/$relative")
  [[ $target == "$storage_dir/$relative" ]] || fail "unsafe data path: $relative"
  if [[ -e $target ]]; then
    [[ -d $target && ! -L $storage_dir/$relative ]] || fail "unsafe data directory: $relative"
    [[ $(findmnt -rn -o TARGET --target "$target") == "$storage_mount" ]] || fail "data directory is another mount: $relative"
  fi
done
marker=$storage_dir/.system-bootstrapper-volume
if [[ -e $marker || -L $marker ]]; then
  [[ -f $marker && ! -L $marker ]] || fail 'invalid volume marker.'
  [[ $(cat -- "$marker") == system-bootstrapper-persistence-v1 ]] || fail 'unsupported volume marker.'
fi
umask 077
if [[ ${PERSISTENCE_CHECK_ONLY:-0} == 1 ]]; then
  printf 'Persistent storage selection verified.\n'
  exit 0
fi
mkdir -p -- "$storage_dir" "$storage_dir/configuration" "$storage_dir/wizard-public" "$storage_dir/templates" \
  "$storage_dir/synctemplates" "$storage_dir/host/letsencrypt" "$storage_dir/ssl" "$storage_dir/runners" "$storage_dir/gitlab/config" \
  "$storage_dir/gitlab/logs" "$storage_dir/gitlab/data" "$storage_dir/ssl/acme-http01"
chmod 0700 -- "$storage_dir/configuration"
chmod 0755 -- "$storage_dir/wizard-public"
# The worker serves public HTTP-01 tokens through /ssl; private live/key
# directories retain their own modes. Add traversal, never directory listing.
chmod a+x -- "$storage_dir/ssl"
chmod 0755 -- "$storage_dir/ssl/acme-http01"
marker_next=$(mktemp "$storage_dir/.persistence-marker.XXXXXXXX")
printf '%s\n' system-bootstrapper-persistence-v1 > "$marker_next"
mv -Tf -- "$marker_next" "$marker"
printf 'Persistent storage verified: %s\n' "$storage_dir"
