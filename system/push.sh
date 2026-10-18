#!/bin/bash
set -euo pipefail
shopt -s dotglob nullglob

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
config_dir=${SYSTEM_CONFIG_DIR:-$PWD}
if [[ ! -f ../bootstrapper.zip ]]; then
  echo 'no bootstrapper.zip found' >&2
  exit 1
fi

umask 077
staging=$(mktemp -d /tmp/bootstrapper-push.XXXXXXXX)
snapshot=$staging/.system-wizard-receipt
next=
cleanup() {
  result=$?
  trap - EXIT
  # A failed import must still retain the server-owned Wizard receipt.
  if [[ -f $snapshot ]]; then
    node "$script_dir/../project-bootstrap/preserve-system-project.js" restore \
      "$config_dir/.projects.env/.wizard.env" "$snapshot" || result=1
  fi
  if [[ -n $next ]]; then rm -f -- "$next"; fi
  rm -rf -- "$staging"
  exit "$result"
}
trap cleanup EXIT

unzip -q ../bootstrapper.zip -d "$staging/archive"
source_dir=$staging/archive
configs=()
for source in "$source_dir"/*.env; do
  [[ $source == "$source_dir/.projects.env" && -d $source ]] && continue
  [[ -f $source ]] || { echo 'Configuration entry is not a regular file.' >&2; exit 1; }
  configs+=("$source")
done
if [[ ${#configs[@]} == 0 && ! -d $source_dir/.projects.env ]]; then
  echo 'No configuration found in archive.' >&2
  exit 1
fi
# Configuration archives contain data files, never filesystem links.
if [[ -n $(find "$source_dir" -type l -print -quit) ]]; then
  echo 'Configuration archive contains a symbolic link.' >&2
  exit 1
fi
mkdir -p -- "$config_dir/.projects.env"
if [[ -d $source_dir/.projects.env ]]; then
  node "$script_dir/../project-bootstrap/preserve-system-project.js" snapshot \
    "$config_dir/.projects.env/.wizard.env" "$snapshot"
  rsync -a --delete "$source_dir/.projects.env/" "$config_dir/.projects.env/"
  node "$script_dir/../project-bootstrap/preserve-system-project.js" restore \
    "$config_dir/.projects.env/.wizard.env" "$snapshot"
fi
for source in "${configs[@]}"; do
  [[ -f $source ]] || { echo 'Configuration entry is not a regular file.' >&2; exit 1; }
  # Write the canonical state directory directly, including after reset when
  # runtime/.docker.env is an intentionally dangling compatibility link.
  next=$(mktemp "$config_dir/.push-config.XXXXXXXX")
  cp -- "$source" "$next"
  chmod 0600 -- "$next"
  mv -f -- "$next" "$config_dir/$(basename -- "$source")"
  next=
done
echo 'Ready.'
