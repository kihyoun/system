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
# Use the same mutex as native project setup; classify and persist under the
# lease, then let the nested apply reuse it through the inherited descriptor.
exec 9>/tmp/system-bootstrapper-project-routing.lock
flock 9
staging=$(mktemp -d /tmp/bootstrapper-push.XXXXXXXX)
snapshot=$staging/.system-wizard-receipt
next=
rollback=false
cleanup() {
  result=$?
  trap - EXIT
  if [[ $result != 0 && $rollback == true ]]; then
    # The old active proxy config is retained by the reload transaction. Restore
    # saved inputs as well, so a subsequent startup cannot apply the failed route.
    if [[ -d $staging/previous/.projects.env ]]; then
      rsync -a --delete --exclude=/.wizard.env.environments.lock/ "$staging/previous/.projects.env/" "$config_dir/.projects.env/" || result=1
    fi
    if [[ -f $staging/previous/.docker.env ]]; then
      cp -p -- "$staging/previous/.docker.env" "$config_dir/.docker.env" || result=1
    fi
    echo 'Routing apply failed; previous configuration restored. Inspect the proxy status before retrying.' >&2
  fi
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

node "$script_dir/../project-bootstrap/configuration-archive.js" ../bootstrapper.zip
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
node "$script_dir/../nginx/wizard-aliases.js" validate-import "$source_dir" "$config_dir"
node "$script_dir/../nginx/application-aliases.js" validate-import "$source_dir" "$config_dir"
impact=$(node "$script_dir/../project-bootstrap/routing-impact.js" "$source_dir" "$config_dir")
apply_mode=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).mode)' "$impact")
if [[ -n ${SYSTEM_PUSH_IMPACT:-} ]]; then
  actual=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).fingerprint)' "$impact")
  [[ $actual == "$SYSTEM_PUSH_IMPACT" ]] || { echo 'Configuration changed since impact review.' >&2; exit 1; }
fi
if [[ $apply_mode == routing ]]; then
  mkdir -p "$staging/previous/.projects.env"
  cp -p -- "$config_dir/.docker.env" "$staging/previous/.docker.env"
  rsync -a --exclude=/.wizard.env.environments.lock/ "$config_dir/.projects.env/" "$staging/previous/.projects.env/"
  rollback=true
fi
mkdir -p -- "$config_dir/.projects.env"
if [[ -d $source_dir/.projects.env ]]; then
  node "$script_dir/../project-bootstrap/preserve-system-project.js" snapshot \
    "$config_dir/.projects.env/.wizard.env" "$snapshot"
  # Runtime operation barriers are server-owned, never configuration content.
  rsync -a --delete --exclude=/.wizard.env.environments.lock/ "$source_dir/.projects.env/" "$config_dir/.projects.env/"
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
if [[ $apply_mode == routing ]]; then
  mapfile -t project_keys < <(node -e 'for (const key of JSON.parse(process.argv[1]).projects) console.log(key)' "$impact")
  (cd "$script_dir/../project-bootstrap"; SYSTEM_ROUTING_LOCK_HELD=true bash apply.sh "${project_keys[@]}")
  rollback=false
fi
printf 'APPLY_MODE=%s\n' "$apply_mode"
echo 'Ready.'
