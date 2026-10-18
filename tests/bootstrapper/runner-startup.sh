#!/usr/bin/env bash
set -euo pipefail
source_script="$(cd "$(dirname "$0")/../.." && pwd)/system/start-intermediate.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
for service in system gitlab nginx-proxy gitlab-runner wizard; do
    mkdir "$fixture/$service"
    printf 'echo "%s" >> ../started\n' "$service" > "$fixture/$service/start.sh"
done
printf 'exit 1\n' >> "$fixture/gitlab-runner/start.sh"
printf 'echo registry-recovery >> ../started\n' > "$fixture/system/ensure-wizard-image.sh"
cp "$source_script" "$fixture/system/start-intermediate.sh"
cd "$fixture/system"
bash start-intermediate.sh
grep -qx wizard ../started
grep -qx gitlab ../started
grep -qx registry-recovery ../started
echo 'PASS: failed runner setup leaves the Wizard and platform startup available.'
: > ../started
printf 'exit 1\n' >> ensure-wizard-image.sh
if bash start-intermediate.sh; then
    echo 'Registry recovery failure was ignored.' >&2
    exit 1
fi
! grep -qx wizard ../started
! grep -qx nginx-proxy ../started
echo 'PASS: failed private image recovery stops startup before Wizard and project services.'
