#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/gitlab" "$fixture/system" "$fixture/config" "$fixture/bin"
sed "s@/srv/gitlab/config@$fixture/config@g" "$repo/gitlab/start.sh" > "$fixture/gitlab/start.sh"
cp "$repo/gitlab/gitlab.rb" "$fixture/gitlab/gitlab.rb"
cp "$repo/gitlab/docker-compose.omnibus.yml" "$fixture/gitlab/docker-compose.omnibus.yml"
printf '' > "$fixture/gitlab/prepare-root-password.js"
cat > "$fixture/system/.docker.env" <<'EOF'
GITLAB_REGISTRY_DOMAIN_MODE=0
GITLAB_REGISTRY_URL=http://registry.localhost:5050
GITLAB_REGISTRY_HOST=registry.localhost
GITLAB_EXTERNAL_URL=http://gitlab.localhost
EOF
cat > "$fixture/bin/docker-compose" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> ../calls
printf '%s\n' "${GITLAB_OMNIBUS_CONFIG-<unset>}" > ../omnibus.env
EOF
cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '172.19.0.3\n'
EOF
cat > "$fixture/bin/node" <<'EOF'
#!/usr/bin/env bash
# Password setup is outside this startup/recreation contract test.
exit 0
EOF
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
unset GITLAB_OMNIBUS_CONFIG
cd "$fixture/gitlab"
bash start.sh
grep -Fxq -- '-f ../system/docker-compose.yml up --force-recreate -d gitlab' ../calls
grep -Fxq -- '<unset>' ../omnibus.env
printf '' > ../calls
bash start.sh
grep -Fxq -- '-f ../system/docker-compose.yml up -d gitlab' ../calls
printf '' > ../calls
GITLAB_OMNIBUS_CONFIG='' bash start.sh
grep -Fxq -- '-f ../system/docker-compose.yml up -d gitlab' ../calls
printf 'GITLAB_EXTERNAL_URL=http://changed.localhost\n' >> ../system/.docker.env
printf '' > ../calls
bash start.sh
grep -q -- '--force-recreate' ../calls
cp "$fixture/config/gitlab.rb" "$fixture/expected-gitlab.rb"
omnibus="puma['worker_processes'] = 2"
printf '' > ../calls
GITLAB_OMNIBUS_CONFIG="$omnibus" bash start.sh
grep -Fxq -- '-f ../system/docker-compose.yml -f ../gitlab/docker-compose.omnibus.yml up -d gitlab' ../calls
grep -Fxq -- "$omnibus" ../omnibus.env
cmp "$fixture/expected-gitlab.rb" "$fixture/config/gitlab.rb"
# A saved shell assignment must be exported before Compose interpolates it.
printf 'GITLAB_OMNIBUS_CONFIG=%q\n' "$omnibus" >> ../system/.docker.env
printf '' > ../calls
bash start.sh
grep -Fxq -- '-f ../system/docker-compose.yml -f ../gitlab/docker-compose.omnibus.yml up -d gitlab' ../calls
grep -Fxq -- "$omnibus" ../omnibus.env
cmp "$fixture/expected-gitlab.rb" "$fixture/config/gitlab.rb"
grep -Fxq '      GITLAB_OMNIBUS_CONFIG: ${GITLAB_OMNIBUS_CONFIG:?GITLAB_OMNIBUS_CONFIG must be set}' docker-compose.omnibus.yml
echo 'GitLab startup preserves defaults and forwards explicit Omnibus settings across native starts.'
