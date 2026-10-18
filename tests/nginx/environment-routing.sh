#!/usr/bin/env bash
# Offline fixture: mocks every Docker operation and owns its disposable templates.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture"/{system/.projects.env,gitlab,nginx,nginx-proxy/.projects,wizard,bin} /templates/wizard-environments
cp -a "$root/nginx/.templates" "$fixture/nginx/"
cp "$root/nginx/start.sh" "$fixture/nginx/"
cp "$root/nginx-proxy/"{start,stop}.sh "$fixture/nginx-proxy/"
# Root owns the actual ACME template. This fixture isolates its copy contract.
printf '# offline ACME sentinel\n' > "$fixture/nginx/.templates/acme-http01.conf.template"
printf '# owned candidate sentinel\n' > /templates/wizard-environments/review.conf
node - "$root" "$fixture" <<'NODE'
const fs = require('fs'), path = require('path');
const [root, fixture] = process.argv.slice(2);
const logo = require(path.join(root, 'sync/dist/Helper')).default.textLogo;
const write = (name, text) => fs.writeFileSync(path.join(fixture, name), logo + text);
write('.docker.env', 'BOOTSTRAPPER_IP=127.0.0.1\n');
write('gitlab/.docker.env', 'GITLAB_IP=127.0.0.1\n');
write('wizard/.docker.env', 'WIZARD_IP=127.0.0.1\n');
write('system/.docker.env', 'GITLAB_HOST=gitlab.localhost\nGITLAB_DOMAIN_MODE=0\nGITLAB_REGISTRY_HOST=registry.localhost\nGITLAB_REGISTRY_DOMAIN_MODE=0\nSYNC_ENABLE=true\nSYNC_HOST=sync.localhost\nSYNC_DOMAIN_MODE=0\nWIZARD_ENABLE=true\nWIZARD_HOST=production.localhost\nWIZARD_DOMAIN_MODE=0\n');
write('system/.projects.env/.wizard.env', 'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\nUSE_PROD_HOST=true\nUSE_BETA_HOST=true\nUSE_REVIEW_HOST=true\n');
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
cd "$fixture/nginx"
for mode in start reload; do
  if [ "$mode" = start ]; then bash -e start.sh; else bash -e start.sh reload; fi
  test "$(grep -c '^include /etc/nginx/templates/wizard-environments/\*.conf;$' /templates/default.conf.template)" -eq 1
  test "$(grep -c 'server_name production.localhost;' /templates/default.conf.template)" -eq 1
  ! grep -q 'wizard_review\|wizard_beta\|wizard_prod' /templates/default.conf.template
  cmp "$fixture/nginx/.templates/acme-http01.conf.template" /templates/00-acme-http01.conf.template
  test "$(cat /templates/wizard-environments/review.conf)" = '# owned candidate sentinel'
done
! grep -q 'restart\|system_wizard_1\|system_gitlab_1' "$TRACE"
grep -q 'nginx -t' "$TRACE"
grep -q 'nginx -s reload' "$TRACE"
echo 'PASS: start/reload preserve optional candidate fragments, copy HTTP01 template, and retain exactly one Production Wizard route without extra project proxies.'
