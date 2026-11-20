#!/usr/bin/env bash
# Run in an isolated container: this test renders its disposable /templates file.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
ln -s "$root/operations" "$fixture/operations"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture"/{system/.projects.env,gitlab,nginx,nginx-proxy/.projects,wizard,gitlab-runner,bin} /templates
cp -a "$root/nginx/.templates" "$fixture/nginx/"
cp "$root/nginx/"{wizard-aliases.js,application-aliases.js} "$fixture/nginx/"
mkdir -p "$fixture/project-bootstrap"
cp "$root/project-bootstrap/preserve-system-project.js" "$fixture/project-bootstrap/"
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
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" TRACE="$fixture/trace"
touch "$TRACE"
cd "$fixture/nginx-proxy"
node "$root/operations/dist/projects-routing/entry.js" routing proxies "$fixture" ""
node "$root/operations/dist/projects-routing/entry.js" routing stop-proxies "$fixture" ""
test ! -s "$TRACE"
cd "$fixture/gitlab-runner"
node "$root/operations/dist/lifecycle/entry.js" runner-start "$fixture" projects
node "$root/operations/dist/lifecycle/entry.js" runner-stop "$fixture" projects
node "$root/operations/dist/lifecycle/entry.js" runner-register "$fixture" projects
node "$root/operations/dist/lifecycle/entry.js" runner-unregister "$fixture" projects
test ! -s "$TRACE"
cd "$fixture/nginx"
node "$root/operations/dist/projects-routing/entry.js" routing reload "$fixture" /templates
test "$(grep -c 'server_name localhost;' /templates/default.conf.template)" -eq 1
! grep -q wizard_prod /templates/default.conf.template
! grep -q 'wizard_runner\|wizard_prod' "$TRACE"
echo 'PASS: exactly one real Wizard route and no extra proxy/runner lifecycle resources.'
# Every environment combination is valid, including Beta-only and none.
# The provisioning entry point enables errexit for this renderer.
for prod in false true; do
  for beta in false true; do
    for review in false true; do
      cat > "$fixture/system/.projects.env/.application.env" <<EOF
PROJECT_NAME=application
USE_PROD_HOST=$prod
USE_BETA_HOST=$beta
USE_REVIEW_HOST=$review
EOF
      cp "$fixture/system/.projects.env/.application.env" "$fixture/nginx-proxy/.projects/.application.env"
      for env in PROD BETA REVIEW; do
        printf '%s_DOMAIN_MODE=0\n%s_PROXY=127.0.0.1\n%s_HOST=%s.localhost\n' "$env" "$env" "$env" "$env" >> "$fixture/nginx-proxy/.projects/.application.env"
      done
      for mode in start reload; do
        : > "$TRACE"
        if [ "$mode" = start ]; then node "$root/operations/dist/projects-routing/entry.js" routing start "$fixture" /templates; else node "$root/operations/dist/projects-routing/entry.js" routing reload "$fixture" /templates; fi
        for env in PROD BETA REVIEW; do
          flag=$(printf '%s' "$env" | tr '[:upper:]' '[:lower:]')
          count=$(grep -c "server_name $env.localhost;" /templates/default.conf.template || true)
          if [ "${!flag}" = true ]; then test "$count" -eq 1; else test "$count" -eq 0; fi
        done
        if [ "$mode" = reload ]; then
          grep -q 'nginx -t' "$TRACE"
          grep -q 'nginx -s reload' "$TRACE"
          ! grep -q 'up --build' "$TRACE"
        else
          grep -q 'up --build --remove-orphans --force-recreate -d web' "$TRACE"
          ! grep -q 'nginx -s reload' "$TRACE"
        fi
        grep -q 'server_name localhost;' /templates/default.conf.template
        grep -q 'server_name sync.localhost;' /templates/default.conf.template
      done
    done
  done
done
echo 'PASS: all eight application environment combinations start and reload under errexit.'
# A disabled environment must succeed without hiding a real rendering failure
# in any enabled environment. Remove the application TLS template, not GitLab's
# earlier route, and require exit before any Docker start/reload operation.
mv "$fixture/nginx/.templates/default.ssl.conf.template" "$fixture/nginx/.templates/default.ssl.conf.saved"
for environment in PROD BETA REVIEW; do
  printf 'PROJECT_NAME=application\nUSE_PROD_HOST=false\nUSE_BETA_HOST=false\nUSE_REVIEW_HOST=false\nUSE_%s_HOST=true\n' "$environment" > "$fixture/system/.projects.env/.application.env"
  cp "$fixture/system/.projects.env/.application.env" "$fixture/nginx-proxy/.projects/.application.env"
  for env in PROD BETA REVIEW; do
    printf '%s_DOMAIN_MODE=2\n%s_PROXY=127.0.0.1\n%s_HOST=%s.localhost\n' "$env" "$env" "$env" "$env" >> "$fixture/nginx-proxy/.projects/.application.env"
  done
  for mode in start reload; do
    : > "$TRACE"
    result=0
    if [ "$mode" = start ]; then node "$root/operations/dist/projects-routing/entry.js" routing start "$fixture" /templates || result=$?; else node "$root/operations/dist/projects-routing/entry.js" routing reload "$fixture" /templates || result=$?; fi
    test "$result" -ne 0
    test ! -s "$TRACE"
  done
done
mv "$fixture/nginx/.templates/default.ssl.conf.saved" "$fixture/nginx/.templates/default.ssl.conf.template"
echo 'PASS: enabled application rendering failures stop start/reload before Docker.'
node "$root/operations/dist/projects-routing/entry.js" routing recovery "$fixture" /templates
grep -q 'server_name gitlab.localhost;' /templates/default.conf.template
grep -q 'server_name registry.localhost;' /templates/default.conf.template
! grep -q 'server_name localhost;\|server_name sync.localhost;\|wizard-environments\|wizard_prod' /templates/default.conf.template
echo 'PASS: registry recovery renders only GitLab and registry routing before Wizard is available.'
