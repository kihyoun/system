#!/usr/bin/env bash
# Run in the isolated component container; Docker is replaced by a trace stub.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture"/{system/.projects.env,gitlab,nginx,nginx-proxy/.projects,wizard,project-bootstrap,bin} /templates
cp -a "$root/nginx/.templates" "$fixture/nginx/"
cp "$root/nginx/"{start.sh,wizard-aliases.js} "$fixture/nginx/"
cp "$root/project-bootstrap/preserve-system-project.js" "$fixture/project-bootstrap/"
printf 'BOOTSTRAPPER_IP=127.0.0.1\n' > "$fixture/.docker.env"
printf 'GITLAB_IP=127.0.0.1\n' > "$fixture/gitlab/.docker.env"
printf 'WIZARD_IP=127.0.0.1\n' > "$fixture/wizard/.docker.env"
cat > "$fixture/system/.docker.env" <<'ENV'
GITLAB_HOST=gitlab.example.test
GITLAB_DOMAIN_MODE=0
GITLAB_REGISTRY_HOST=registry.example.test
GITLAB_REGISTRY_DOMAIN_MODE=0
SYNC_ENABLE=true
SYNC_HOST=sync.example.test
SYNC_DOMAIN_MODE=0
WIZARD_ENABLE=true
WIZARD_HOST=wizard.example.test
WIZARD_DOMAIN_MODE=2
WIZARD_SSL=/ssl/live/example/fullchain.pem
WIZARD_SSL_KEY=/ssl/live/example/privkey.pem
WIZARD_ALIASES='example.test old.example.test'
ENV
printf '#!/bin/sh\necho "$*" >> "$TRACE"\n' > "$fixture/bin/docker"
cp "$fixture/bin/docker" "$fixture/bin/docker-compose"
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" TRACE="$fixture/trace"
cd "$fixture/nginx"
for mode in start reload; do
  if [[ $mode == start ]]; then bash -e start.sh; else bash -e start.sh reload; fi
  test "$(grep -c 'return 308 https://wizard.example.test$request_uri;' /templates/zz-wizard-aliases.conf.template)" -eq 2
  test "$(grep -c 'location \^~ /.well-known/acme-challenge/' /templates/zz-wizard-aliases.conf.template)" -eq 2
done
cp /templates/default.conf.template "$fixture/original-main"
cp /templates/zz-wizard-aliases.conf.template "$fixture/original-alias"
printf '\nGITLAB_HOST=example.test\n' >> "$fixture/system/.docker.env"
if bash -e start.sh reload > /dev/null 2>&1; then echo 'Conflicting aliases were accepted.' >&2; exit 1; fi
cmp /templates/default.conf.template "$fixture/original-main"
cmp /templates/zz-wizard-aliases.conf.template "$fixture/original-alias"
sed -i '$d' "$fixture/system/.docker.env"
bash -e start.sh recovery
test -z "$(cat /templates/zz-wizard-aliases.conf.template)"
bash -e start.sh
cmp /templates/zz-wizard-aliases.conf.template "$fixture/original-alias"
sed -i 's/^WIZARD_ALIASES=.*/WIZARD_ALIASES=""/' "$fixture/system/.docker.env"
bash -e start.sh reload
test -z "$(cat /templates/zz-wizard-aliases.conf.template)"
grep -q 'nginx -t' "$TRACE"
grep -q 'nginx -s reload' "$TRACE"
echo 'PASS: aliases regenerate on start/reload, clear on recovery/disable, and conflicts leave previous templates intact.'
