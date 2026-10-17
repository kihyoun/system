#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/gitlab" "$fixture/system" "$fixture/config" "$fixture/bin"
sed "s@/srv/gitlab/config@$fixture/config@g" "$repo/gitlab/start.sh" > "$fixture/gitlab/start.sh"
cp "$repo/gitlab/gitlab.rb" "$fixture/gitlab/gitlab.rb"
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
cd "$fixture/gitlab"
bash start.sh
grep -q -- '--force-recreate' ../calls
printf '' > ../calls
bash start.sh
if grep -q -- '--force-recreate' ../calls; then echo 'Unchanged GitLab must not be recreated' >&2; exit 1; fi
printf 'GITLAB_EXTERNAL_URL=http://changed.localhost\n' >> ../system/.docker.env
printf '' > ../calls
bash start.sh
grep -q -- '--force-recreate' ../calls
echo 'GitLab startup preserves unchanged containers and applies changed configuration.'
