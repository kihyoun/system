#!/bin/sh
# Build/job-image only: install the reviewed public Mozilla bundle offline.
# Runtime custom trust must be reviewed separately; never run on the host OS.
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")/ca" && pwd)
bundle="$directory/cacert-2026-10-20.crt"
printf '%s  %s\n' 796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe "$bundle" | sha256sum -c - >/dev/null
test -d /etc/ssl/certs
# Merely replacing the bundle leaves distrusted OpenSSL hash links trusted.
find /etc/ssl/certs -mindepth 1 -maxdepth 1 \( -type f -o -type l \) -exec rm -f {} \;
cp "$bundle" /etc/ssl/certs/ca-certificates.crt
chmod 0644 /etc/ssl/certs/ca-certificates.crt
ln -sf certs/ca-certificates.crt /etc/ssl/cert.pem
