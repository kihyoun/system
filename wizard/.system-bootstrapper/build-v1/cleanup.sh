# Sourced by managed jobs. Only exact job-scoped resources are removed.
cleanup_resource() {
  kind=$1; name=$2
  [ -n "$name" ] || return 0
  case "$kind" in
    container) listing=$(timeout 8 docker container ls --all --filter "name=^/${name}$" --format '{{.Names}}' 2>/dev/null) || return 1;;
    network) listing=$(timeout 8 docker network ls --filter "name=^${name}$" --format '{{.Name}}' 2>/dev/null) || return 1;;
    volume) listing=$(timeout 8 docker volume ls --filter "name=^${name}$" --format '{{.Name}}' 2>/dev/null) || return 1;;
    image)
      # Docker adds :latest when the final path component has no explicit tag.
      # A colon in the registry authority is a port, not the image's tag.
      case "$name" in
        *@*) ;;
        *) case "${name##*/}" in *:*) ;; *) name="$name:latest";; esac;;
      esac
      case "$name" in
        *@sha256:*) repository=${name%@sha256:*}; rows=$(timeout 8 docker image ls --digests --filter "reference=$repository" --format '{{.Repository}}@{{.Digest}}' 2>/dev/null) || return 1;;
        *) rows=$(timeout 8 docker image ls --filter "reference=$name" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null) || return 1;;
      esac
      listing=
      for row in $rows; do [ "$row" != "$name" ] || listing=$row; done;;
    *) return 1;;
  esac
  [ -n "$listing" ] || return 0
  [ "$listing" = "$name" ] || return 1
  case "$kind" in
    container) timeout 8 docker rm -f "$name" >/dev/null 2>&1;;
    *) timeout 8 docker "$kind" rm "$name" >/dev/null 2>&1;;
  esac
}
cleanup_builder() {
  if builders=$(timeout 8 docker buildx ls --format '{{.Name}}' 2>/dev/null); then
    for listed_builder in $builders; do
      if [ "$listed_builder" = "$builder" ]; then
        timeout 12 docker buildx rm -f "$builder" >/dev/null 2>&1 || cleanup_failed=1
      fi
    done
  else
    cleanup_failed=1
  fi
  # Recover precisely owned orphans even if the client lost builder metadata.
  cleanup_resource container "buildx_buildkit_${builder}0" || cleanup_failed=1
  cleanup_resource volume "buildx_buildkit_${builder}0_state" || cleanup_failed=1
}
wizard_on_exit() {
  primary_status=$?
  trap - EXIT INT TERM
  cleanup_failed=0
  if [ -n "${browser:-}" ]; then
    timeout 8 docker cp "$browser:/evidence/." browser-evidence/ >/dev/null 2>&1 || true
    cleanup_resource container "$browser" || cleanup_failed=1
  fi
  cleanup_resource container "${candidate:-}" || cleanup_failed=1
  cleanup_resource network "${network:-}" || cleanup_failed=1
  cleanup_resource image "${browser_image:-}" || cleanup_failed=1
  cleanup_resource image "${image:-${WIZARD_IMAGE_REF:-}}" || cleanup_failed=1
  cleanup_builder
  cleanup_status=passed
  [ "$cleanup_failed" -eq 0 ] || cleanup_status=failed
  printf '{"builder":"%s","status":"%s"}\n' "$builder" "$cleanup_status" > cleanup.json || cleanup_failed=1
  if [ "$cleanup_failed" -ne 0 ]; then
    echo 'Owned Wizard job cleanup failed; inspect this job resource set before retrying.' >&2
    [ "$primary_status" -ne 0 ] || primary_status=1
  fi
  exit "$primary_status"
}
