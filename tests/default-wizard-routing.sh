#!/usr/bin/env bash
# Run in an isolated container: this test renders its disposable /templates file.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture"/{system/.projects.env,gitlab,nginx,nginx-proxy/.projects,wizard,gitlab-runner,bin} /templates
cp -a "$root/nginx/.templates" "$fixture/nginx/"
cp "$root/nginx/start.sh" "$fixture/nginx/"
cp "$root/nginx-proxy/"{start,stop}.sh "$fixture/nginx-proxy/"
cp "$root/gitlab-runner/"{start,stop,register,unregister}.sh "$fixture/gitlab-runner/"
node - "$root" "$fixture" <<'NODE'
const fs=require('fs'),path=require('path');
const [root,fixture]=process.argv.slice(2);
const logo=require(path.join(root,'sync/dist/Helper')).default.textLogo;
const write=(p,body)=>fs.writeFileSync(path.join(fixture,p),logo+body);
write('.docker.env','BOOTSTRAPPER_IP=127.0.0.1\n');
write('gitlab/.docker.env','GITLAB_IP=127.0.0.1\n');
write('wizard/.docker.env','WIZARD_IP=127.0.0.1\n');
write('system/.docker.env','GITLAB_HOST=gitlab.localhost\nGITLAB_DOMAIN_MODE=0\nGITLAB_REGISTRY_HOST=registry.localhost\nGITLAB_REGISTRY_DOMAIN_MODE=0\nSYNC_ENABLE=true\nSYNC_HOST=sync.localhost\nSYNC_DOMAIN_MODE=0\nWIZARD_ENABLE=true\nWIZARD_HOST=localhost\nWIZARD_DOMAIN_MODE=0\nGITLAB_RUNNER_SCALE=0\n');
fs.writeFileSync(path.join(fixture,'system/.projects.env/.wizard.env'),require(path.join(root,'sync/dist/DefaultWizard')).wizardConfiguration({WIZARD_HOST:'localhost'}));
NODE
printf '#!/bin/sh\necho "$*" >> "$TRACE"\n' > "$fixture/bin/docker"
cp "$fixture/bin/docker" "$fixture/bin/docker-compose"
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" TRACE="$fixture/trace"
touch "$TRACE"
cd "$fixture/nginx-proxy"
bash -e start.sh
bash -e stop.sh
test ! -s "$TRACE"
cd "$fixture/gitlab-runner"
bash -e start.sh projects
bash -e stop.sh projects
bash -e register.sh projects
bash -e unregister.sh projects
test ! -s "$TRACE"
cd "$fixture/nginx"
bash -e start.sh reload
test "$(grep -c 'server_name localhost;' /templates/default.conf.template)" -eq 1
! grep -q wizard_prod /templates/default.conf.template
! grep -q 'wizard_runner\|wizard_prod' "$TRACE"
echo 'PASS: exactly one real Wizard route and no extra proxy/runner lifecycle resources.'
