#!/bin/sh
# Protected CI entrypoint. Keep credentials out of the checkout and job output.
set +x
set -eu
umask 077
fail() { printf '%s\n' "GitHub backup CI failed: $1" >&2; exit 1; }
skip() { printf '%s\n' "GitHub backup skipped: $1"; exit 0; }
[ "${GITHUB_BACKUP_ENABLED:-}" = true ] || skip 'not enabled'
[ "${GITLAB_CI:-}" = true ] || fail 'GitLab CI context required'
[ "${CI_PIPELINE_SOURCE:-}" = push ] || skip 'not a push pipeline'
[ -z "${CI_COMMIT_TAG:-}" ] || skip 'tag pipeline'
[ -n "${CI_DEFAULT_BRANCH:-}" ] || fail 'default branch missing'
[ "${CI_COMMIT_BRANCH:-}" = "$CI_DEFAULT_BRANCH" ] || skip 'not the default branch'
[ "${CI_COMMIT_REF_PROTECTED:-}" = true ] || fail 'protected default branch required'
[ -n "${GITHUB_BACKUP_SOURCE_PROJECT:-}" ] || fail 'source project mapping missing'
[ "${CI_PROJECT_PATH:-}" = "$GITHUB_BACKUP_SOURCE_PROJECT" ] || fail 'source project mapping mismatch'
[ -n "${GITHUB_SSH_PRIVATE_KEY:-}" ] || fail 'protected SSH key missing'
[ -n "${GITHUB_SSH_KNOWN_HOSTS:-}" ] && [ -f "$GITHUB_SSH_KNOWN_HOSTS" ] || fail 'verified known-hosts file variable missing'
for tool in git node ssh ssh-agent ssh-add ssh-keygen mktemp; do
  command -v "$tool" >/dev/null 2>&1 || fail 'required runtime tool missing'
done
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
private_dir=$(mktemp -d "${TMPDIR:-/tmp}/system-github-backup.XXXXXXXX") || fail 'private directory unavailable'
agent_started=false
cleanup() {
  if [ "$agent_started" = true ]; then ssh-agent -k >/dev/null 2>&1 || :; fi
  rm -f "$private_dir/known_hosts"
  rmdir "$private_dir" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp "$GITHUB_SSH_KNOWN_HOSTS" "$private_dir/known_hosts"
chmod 600 "$private_dir/known_hosts"
ssh-keygen -F github.com -f "$private_dir/known_hosts" >/dev/null 2>&1 || fail 'verified GitHub host key missing'
eval "$(ssh-agent -s 2>/dev/null)" >/dev/null || fail 'SSH agent unavailable'
agent_started=true
if [ -f "$GITHUB_SSH_PRIVATE_KEY" ]; then
  ssh-add "$GITHUB_SSH_PRIVATE_KEY" >/dev/null 2>&1 || fail 'SSH identity could not be loaded'
else
  # Existing protected multiline variables remain supported; prefer file type.
  printf '%s\n' "$GITHUB_SSH_PRIVATE_KEY" | tr -d '\r' | ssh-add - >/dev/null 2>&1 || fail 'SSH identity could not be loaded'
fi
unset GITHUB_SSH_PRIVATE_KEY
GITHUB_BACKUP_KNOWN_HOSTS_FILE="$private_dir/known_hosts"
export GITHUB_BACKUP_KNOWN_HOSTS_FILE
sh "$script_dir/github-backup.sh"
