#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# Resolve metadata without Git: Windows-created linked worktrees use drive paths
# that Linux Git cannot follow directly. Object-only commands accept --git-dir.
git_directory() {
  local repository=$1 directory pointer
  if [ -f "$repository/.git" ]; then
    IFS= read -r pointer < "$repository/.git"
    directory=${pointer#gitdir: }; directory=${directory%$'\r'}
    if [[ "$directory" =~ ^[A-Za-z]:/ ]]; then
      directory=$(wslpath -u "$directory")
    elif [[ "$directory" != /* ]]; then directory="$repository/$directory"; fi
  else directory="$repository/.git"; fi
  realpath "$directory"
}
export SYSTEM_SOURCE_GIT_DIR=$(git_directory "$PWD")
export WIZARD_SOURCE_GIT_DIR=$(git_directory "$PWD/wizard")
if command -v node >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  node project-bootstrap/wizard-source/package.js
else
  # Build the same reviewed base recipe used by the System. Its pinned runtime
  # includes Git; the plain official Node image alone does not.
  docker build -t system-bootstrapper-source-tools:local ./bootstrapper
  mounts=(--mount "type=bind,src=$PWD,dst=$PWD,readonly")
  # Linked worktrees/submodules may point outside the source directory.
  # Mount only their Git metadata read-only at the original absolute paths.
  mounted="|$PWD|"
  for gitdir in "$SYSTEM_SOURCE_GIT_DIR" "$WIZARD_SOURCE_GIT_DIR"; do
    common=$gitdir
    if [ -f "$gitdir/commondir" ]; then
      IFS= read -r common < "$gitdir/commondir"; common=${common%$'\r'}
      [[ "$common" = /* ]] || common="$gitdir/$common"
      common=$(realpath "$common")
    fi
    for directory in "$gitdir" "$common"; do
      case "$directory/" in "$PWD/"*) ;; *)
        if [[ "$mounted" != *"|$directory|"* ]]; then
          mounts+=(--mount "type=bind,src=$directory,dst=$directory,readonly")
          mounted+="$directory|"
        fi;; esac
    done
  done
  output=project-bootstrap/wizard-source/snapshot.json
  temporary=$(mktemp "$output.XXXXXX")
  trap 'rm -f "$temporary"' EXIT
  docker run --rm --network none --read-only "${mounts[@]}" -e SYSTEM_SOURCE_GIT_DIR -e WIZARD_SOURCE_GIT_DIR \
    -w "$PWD" --entrypoint node \
    system-bootstrapper-source-tools:local project-bootstrap/wizard-source/package.js --stdout > "$temporary"
  mv "$temporary" "$output"
fi
