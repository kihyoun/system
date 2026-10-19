#!/bin/sh
# Opt-in CI backup of the exact reviewed default-branch commit.
# Never trace transport commands: credentials may be carried by SSH environment.
set +x
set -eu

fail() { printf '%s\n' "GitHub backup failed: $1" >&2; exit 1; }
skip() { printf '%s\n' "GitHub backup skipped: $1"; exit 0; }
git_safe() { git -c core.hooksPath=/dev/null "$@"; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
transport_pid=
transport() {
  node "$script_dir/github-backup-transport.js" "$@" &
  transport_pid=$!
  result=0
  wait "$transport_pid" || result=$?
  transport_pid=
  return "$result"
}

[ "${GITHUB_BACKUP_ENABLED:-}" = true ] || skip 'not enabled'
[ "${GITLAB_CI:-}" = true ] || fail 'GitLab CI context required'
[ "${CI_PIPELINE_SOURCE:-}" = push ] || skip 'not a push pipeline'
[ -z "${CI_COMMIT_TAG:-}" ] || skip 'tag pipeline'
[ -n "${CI_DEFAULT_BRANCH:-}" ] || fail 'default branch missing'
[ "${CI_COMMIT_BRANCH:-}" = "$CI_DEFAULT_BRANCH" ] || skip 'not the default branch'
[ "${CI_COMMIT_REF_PROTECTED:-}" = true ] || fail 'protected default branch required'
[ -n "${GITHUB_BACKUP_SOURCE_PROJECT:-}" ] || fail 'source project mapping missing'
[ "${CI_PROJECT_PATH:-}" = "$GITHUB_BACKUP_SOURCE_PROJECT" ] || fail 'source project mapping mismatch'

branch=${GITHUB_BACKUP_BRANCH:-}
remote=${GITHUB_BACKUP_REMOTE:-}
[ -n "$branch" ] || fail 'backup branch mapping missing'
git_safe check-ref-format "refs/heads/$branch" >/dev/null 2>&1 || fail 'invalid backup branch'
git_safe check-ref-format "refs/heads/$CI_DEFAULT_BRANCH" >/dev/null 2>&1 || fail 'invalid source branch'
case "$remote" in
  git@github.com:*)
    repository=${remote#git@github.com:}
    case "$repository" in *[!A-Za-z0-9_./-]*|'') fail 'invalid GitHub SSH repository';; esac
    case "$repository" in */*/*|/*|*/../*|../*|*/..|*/.|*/|'') fail 'invalid GitHub SSH repository';; esac
    case "$repository" in */*) ;; *) fail 'GitHub owner/repository required';; esac
    target_protocol=ssh
    ;;
  *)
    # Test-only escape hatch: no network protocol, existing absolute bare path.
    [ "${GITHUB_BACKUP_OFFLINE_FIXTURE:-}" = 1 ] || fail 'explicit GitHub SSH repository required'
    case "$remote" in /*|[A-Za-z]:/*) ;; *) fail 'absolute offline repository required';; esac
    [ -d "$remote" ] || fail 'offline repository missing'
    [ "$(git_safe --git-dir="$remote" rev-parse --is-bare-repository 2>/dev/null)" = true ] || fail 'offline repository must be bare'
    target_protocol=file
    ;;
esac

sha=${CI_COMMIT_SHA:-}
case "$sha" in ''|*[!0-9a-f]*) fail 'invalid pinned commit';; esac
[ "${#sha}" = 40 ] || [ "${#sha}" = 64 ] || fail 'full pinned commit required'
[ "$(git_safe rev-parse HEAD 2>/dev/null)" = "$sha" ] || fail 'checkout differs from pinned commit'
[ "$(git_safe cat-file -t "$sha" 2>/dev/null)" = commit ] || fail 'pinned object is not a commit'

common=$(git_safe rev-parse --git-common-dir 2>/dev/null) || fail 'Git directory missing'
lock="$common/system-github-backup.lock"
mkdir "$lock" 2>/dev/null || fail 'checkout backup lock held; inspect any interrupted owner before retry'
source_ref=refs/system-backup/source
target_ref=refs/system-backup/target
cleanup() {
  git_safe update-ref -d "$source_ref" >/dev/null 2>&1 || :
  git_safe update-ref -d "$target_ref" >/dev/null 2>&1 || :
  rmdir "$lock" 2>/dev/null || :
}
trap cleanup EXIT
cancel() {
  if [ -n "$transport_pid" ]; then
    kill -TERM "$transport_pid" 2>/dev/null || :
    wait "$transport_pid" 2>/dev/null || :
  fi
  exit 1
}
trap cancel HUP INT TERM

# Full source ancestry is necessary to distinguish a queued ancestor from a fork.
if [ "$(git_safe rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
  transport fetch --quiet --no-tags --unshallow origin "+refs/heads/$CI_DEFAULT_BRANCH:$source_ref" >/dev/null 2>&1 || fail 'cannot fetch complete source history within transport deadline'
else
  transport fetch --quiet --no-tags origin "+refs/heads/$CI_DEFAULT_BRANCH:$source_ref" >/dev/null 2>&1 || fail 'cannot fetch source default branch within transport deadline'
fi
git_safe merge-base --is-ancestor "$sha" "$source_ref" >/dev/null 2>&1 || fail 'pinned commit is no longer in the source default branch'

attempt=1
while [ "$attempt" -le 3 ]; do
  # Restrict backup transport and avoid logging URLs or raw transport errors.
  transport -c protocol.allow=never -c "protocol.$target_protocol.allow=always" fetch --quiet --no-tags -- "$remote" "+refs/heads/$branch:$target_ref" >/dev/null 2>&1 || fail 'cannot fetch existing backup branch within deadline; inspect mapping, access and history'
  target=$(git_safe rev-parse "$target_ref")
  if git_safe merge-base --is-ancestor "$sha" "$target" >/dev/null 2>&1; then
    printf '%s\n' 'GitHub backup verified: target contains the pinned commit'
    exit 0
  fi
  git_safe merge-base --is-ancestor "$target" "$sha" >/dev/null 2>&1 || fail 'backup history diverged; manual reconciliation required, nothing overwritten'
  # Ordinary push supplies Git's atomic fast-forward check. Never force or merge.
  if transport -c protocol.allow=never -c "protocol.$target_protocol.allow=always" push --no-follow-tags --quiet -- "$remote" "$sha:refs/heads/$branch" >/dev/null 2>&1; then
    # Re-fetch even after apparent success; a lost response is also retried safely.
    :
  fi
  attempt=$((attempt + 1))
done
# The final push may have succeeded despite its response being interrupted.
transport -c protocol.allow=never -c "protocol.$target_protocol.allow=always" fetch --quiet --no-tags -- "$remote" "+refs/heads/$branch:$target_ref" >/dev/null 2>&1 || fail 'cannot verify backup after bounded retries and transport deadlines'
git_safe merge-base --is-ancestor "$sha" "$target_ref" >/dev/null 2>&1 || fail 'backup not verified after bounded retries; retry job after inspecting access/history'
printf '%s\n' 'GitHub backup verified: target contains the pinned commit'
