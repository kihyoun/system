#!/usr/bin/env bash
set -euo pipefail
source_script="$(cd "$(dirname "$0")/.." && pwd)/system/start-intermediate.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
for service in system gitlab nginx-proxy gitlab-runner wizard; do
    mkdir "$fixture/$service"
    printf 'echo "%s" >> ../started\n' "$service" > "$fixture/$service/start.sh"
done
printf 'exit 1\n' >> "$fixture/gitlab-runner/start.sh"
cp "$source_script" "$fixture/system/start-intermediate.sh"
cd "$fixture/system"
bash start-intermediate.sh
grep -qx wizard ../started
grep -qx gitlab ../started
echo 'PASS: failed runner setup leaves the Wizard and platform startup available.'
