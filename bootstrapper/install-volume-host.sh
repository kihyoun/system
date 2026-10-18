#!/usr/bin/env bash
# Install volume-backed host TLS renewal integration after setup or Seed restore.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a
source "${PERSISTENCE_ENV_FILE:-/etc/system-bootstrapper/persistence.env}"
set +a
bash bootstrapper/persistence.sh
if ! awk -v target="$PERSISTENT_MOUNT" '$1 !~ /^#/ && $2 == target { found=1 } END { exit !found }' /etc/fstab; then
    volume_uuid=${PERSISTENT_UUID:-$(findmnt -rn -T "$PERSISTENT_MOUNT" -o UUID)}
    [[ "$volume_uuid" =~ ^[a-fA-F0-9-]+$ ]] || { echo 'Cannot persist the data mount UUID.' >&2; exit 1; }
    printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$volume_uuid" "$PERSISTENT_MOUNT" >> /etc/fstab
fi
state="$PERSISTENT_DIR/host"
install -d -m 0700 "$state"
if [ -d /etc/letsencrypt ] && [ ! -L /etc/letsencrypt ]; then
    host_active=$(find /etc/letsencrypt -type f \( -name '*.pem' -o -path '*/accounts/*' -o -path '*/renewal/*.conf' \) -print -quit)
    volume_active=$(find "$state/letsencrypt" -type f \( -name '*.pem' -o -path '*/accounts/*' -o -path '*/renewal/*.conf' \) -print -quit)
    if [ -n "$host_active" ] && [ -n "$volume_active" ]; then
        echo 'Both host and volume contain active Certbot state; reconcile them first.' >&2
        exit 1
    fi
    if [ -n "$host_active" ] || [ -z "$volume_active" ]; then
        cp -a /etc/letsencrypt/. "$state/letsencrypt/"
    fi
    mv /etc/letsencrypt "/etc/letsencrypt.before-volume-$(date -u +%Y%m%dT%H%M%SZ)"
fi
install -d -m 0700 "$state/letsencrypt"
if [ -L /etc/letsencrypt ]; then
    [ "$(readlink -f /etc/letsencrypt)" = "$state/letsencrypt" ] || exit 1
else
    ln -s "$state/letsencrypt" /etc/letsencrypt
fi
install -d /etc/systemd/system/docker.service.d /etc/systemd/system/certbot.service.d
printf '[Unit]\nRequiresMountsFor=%s\n' "$PERSISTENT_MOUNT" > /etc/systemd/system/docker.service.d/20-system-volume.conf
printf '[Unit]\nRequiresMountsFor=%s\n[Service]\nExecStart=\nExecStart=/usr/local/sbin/system-certbot -q renew\n' "$PERSISTENT_MOUNT" > /etc/systemd/system/certbot.service.d/20-system-volume.conf
install -m 0755 bootstrapper/certbot-with-volume-lock.sh /usr/local/sbin/system-certbot
install -m 0755 bootstrapper/install-volume-certificate.sh /usr/local/sbin/system-install-certificate
python3 bootstrapper/rebind-renewal.py /etc/letsencrypt/renewal "$PERSISTENT_DIR/ssl/acme-http01"
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nexec /usr/local/sbin/system-install-certificate\n' > /etc/letsencrypt/renewal-hooks/deploy/system-web
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/system-web
systemctl daemon-reload
if systemctl list-unit-files certbot.timer --no-legend | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
fi
