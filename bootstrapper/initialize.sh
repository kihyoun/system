#!/usr/bin/env bash
# Initialize a replacement Ubuntu host from reviewed source and retained live data.
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
usage() {
    cat <<'EOF'
Usage: initialize.sh --receipt-dir ABSOLUTE_DIRECTORY [options]

PERSISTENCE_ENV_FILE must select an already mounted retained filesystem with
configuration and recovery/images.json. No disk formatting or Seed restore runs.

  --install-host          Install host dependencies, Docker and Certbot on Ubuntu.
  --swap-gib N            Explicitly create /swapfile (1..32 GiB) on root disk if
                          no swap exists; refuse an existing /swapfile or low disk.
  --timeout SECONDS       Application readiness deadline (default 1200; max 3600).
  --gitlab-token-file FILE Optional private API token for fresh runner-manager checks.
  --redirect-from ORIGIN  Also check this origin redirects to the configured Wizard.
  --renewal-dry-run       Test Certbot renewal through the shared volume lease.
  --help                  Show this help without changing the host.

Logs and JSON receipts are private operation outputs. The script never clones or
patches itself; invoke it from a reviewed, clean Git checkout. Set optional
RECOVERY_MANIFEST_SHA256 from an independently retained manifest checksum.
EOF
}
receipt_dir= timeout=1200 swap_gib=0 install_host=false renewal=false
verify_args=()
while (( $# )); do
    case $1 in
        --help|-h) usage; exit 0 ;;
        --install-host) install_host=true; shift ;;
        --renewal-dry-run) renewal=true; shift ;;
        --receipt-dir|--timeout|--swap-gib|--gitlab-token-file|--redirect-from)
            (( $# >= 2 )) || { usage >&2; exit 1; }
            case $1 in
                --receipt-dir) receipt_dir=$2 ;;
                --timeout) timeout=$2 ;;
                --swap-gib) swap_gib=$2 ;;
                *) verify_args+=("$1" "$2") ;;
            esac
            shift 2 ;;
        *) usage >&2; exit 1 ;;
    esac
done
fail() { printf 'Initialization: %s\n' "$1" >&2; exit 1; }
(( EUID == 0 )) || fail 'run as root.'
[[ $receipt_dir == /* && $receipt_dir != / ]] || fail 'an absolute private receipt directory is required.'
receipt_path=$(realpath -m -- "$receipt_dir")
case "$receipt_path" in "$PWD"|"$PWD"/*) fail 'receipt directory must be outside the checkout.' ;; esac
[[ $timeout =~ ^(0|[1-9][0-9]*)$ ]] && (( timeout <= 3600 )) || fail 'invalid timeout.'
[[ $swap_gib =~ ^([0-9]|[12][0-9]|3[0-2])$ ]] || fail 'swap size must be 0..32 GiB.'
: "${PERSISTENCE_ENV_FILE:?Set PERSISTENCE_ENV_FILE to your private storage selector}"
# Validate storage before touching packages, configuration or service containers.
set -a
source "$PERSISTENCE_ENV_FILE"
set +a
bash bootstrapper/persistence.sh
[[ -f $PERSISTENT_DIR/configuration/.docker.env ]] || fail 'retained live configuration is missing.'
[[ ! -e $receipt_dir && ! -L $receipt_dir ]] || fail 'receipt directory already exists; choose a new operation ID.'
install -d -m 0700 -- "$receipt_dir"
status="$receipt_dir/status"
phase() { printf '%s\n' "$1" > "$status"; printf '%s\n' "$1"; }
trap 'result=$?; if (( result != 0 )); then printf "failed exit=%s\n" "$result" > "$status"; fi' EXIT
# This lease is outside the volume and protects local host operations only.
install -d -m 0700 /run/system-bootstrapper
exec 9>/run/system-bootstrapper/initialize.lock
flock -n 9 || fail 'another host initialization is running.'
phase 'Validating declared archives, source identities and retained configuration'
export PERSISTENCE_ENV_FILE
bash bootstrapper/recover-volume.sh --verify > "$receipt_dir/preflight.log" 2>&1
python3 bootstrapper/verify-runtime.py baseline --persistence-env "$PERSISTENCE_ENV_FILE" \
    --output "$receipt_dir/baseline.json" >> "$receipt_dir/preflight.log" 2>&1
if (( swap_gib )); then
    phase 'Preparing explicitly selected root-disk swap'
    if ! swapon --show=NAME --noheadings | grep -q .; then
        [[ ! -e /swapfile && ! -L /swapfile ]] || fail '/swapfile exists; manage it deliberately.'
        bytes=$(( swap_gib * 1024 * 1024 * 1024 ))
        available=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
        (( available > bytes + 2147483648 )) || fail 'insufficient root-disk room for swap plus 2 GiB reserve.'
        fallocate -l "$bytes" /swapfile
        chmod 0600 /swapfile
        mkswap /swapfile > "$receipt_dir/swap.log" 2>&1
        swapon /swapfile
        if ! awk '$1=="/swapfile" { found=1 } END { exit !found }' /etc/fstab; then
            printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
        fi
    fi
fi
if [[ $install_host == true ]]; then
    phase 'Installing host dependencies with committed Ubuntu installer'
    export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
    bash bootstrapper/install.sh > "$receipt_dir/install.log" 2>&1
    apt-get install -y certbot >> "$receipt_dir/install.log" 2>&1
fi
command -v docker >/dev/null || fail 'Docker is missing; use --install-host.'
command -v certbot >/dev/null || fail 'Certbot is missing; use --install-host.'
# Storage checks describe this host, so a remote Docker context is never valid.
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
export DOCKER_HOST=unix:///var/run/docker.sock
phase 'Loading declared images and starting retained live platform'
bash bootstrapper/recover-volume.sh > "$receipt_dir/recovery.log" 2>&1
phase 'Waiting for application readiness, storage, routing and authenticated Fetch'
python3 bootstrapper/verify-runtime.py check --persistence-env "$PERSISTENCE_ENV_FILE" \
    --baseline "$receipt_dir/baseline.json" --output "$receipt_dir/verification.json" \
    --timeout "$timeout" "${verify_args[@]}" > "$receipt_dir/verification.log" 2>&1
if [[ $renewal == true ]]; then
    phase 'Simulating certificate renewal through the retained-volume lease'
    system-certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew \
        > "$receipt_dir/certificate-renewal.log" 2>&1
    # Certbot can report overall success while a deploy hook failed.
    if grep -Eq 'Hook .*returned error code [1-9]' "$receipt_dir/certificate-renewal.log"; then
        fail 'certificate deploy hook failed; inspect the private renewal log.'
    fi
    grep -q 'all simulated renewals succeeded' "$receipt_dir/certificate-renewal.log" || \
        fail 'renewal simulation did not confirm a certificate renewal.'
    python3 bootstrapper/verify-runtime.py check --persistence-env "$PERSISTENCE_ENV_FILE" \
        --baseline "$receipt_dir/baseline.json" --output "$receipt_dir/verification.json" \
        --timeout 60 "${verify_args[@]}" >> "$receipt_dir/verification.log" 2>&1
fi
phase 'Initialization and runtime verification completed'
