#!/bin/sh
# The helper bind mounts the owned host filesystem. Model that host's mount
# topology, rather than mistaking the helper's bind boundary for another disk.
set -eu
: "${SYSTEM_PUBLIC_UPGRADE_LIVE:?}"
requested= field= next=
for argument in "$@"; do
    if [ "$next" = path ]; then requested=$argument; next=; continue; fi
    if [ "$next" = field ]; then field=$argument; next=; continue; fi
    case $argument in --target|-T) next=path ;; -o) next=field ;; esac
done
case $requested in
    /|"$SYSTEM_PUBLIC_UPGRADE_LIVE"|"$SYSTEM_PUBLIC_UPGRADE_LIVE"/*)
        case $field in MAJ:MIN) printf '0:1\n' ;; UUID) printf '\n' ;; TARGET) printf '/\n' ;; *) exec /usr/bin/findmnt "$@" ;; esac ;;
    *) exec /usr/bin/findmnt "$@" ;;
esac
