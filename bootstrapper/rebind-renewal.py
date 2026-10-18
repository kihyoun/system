#!/usr/bin/env python3
"""Rebind webroot renewal configuration after restoring onto another volume."""
import pathlib
import re
import sys


def rebind(text, webroot):
    if not re.search(r'^authenticator\s*=\s*webroot\s*$', text, re.M):
        return text
    text = re.sub(r'^(webroot_path\s*=\s*).*$', lambda match: match[1] + webroot + ',', text, flags=re.M)
    before, separator, mapping = text.partition('[[webroot_map]]')
    if not separator:
        return text
    # ConfigObj maps end at the next section; preserve unrelated plugin options.
    parts = re.split(r'(?=^\s*\[)', mapping, maxsplit=1, flags=re.M)
    parts[0] = re.sub(r'^(\s*[^#\s][^=\n]*=\s*)/[^\n]*$', lambda match: match[1] + webroot, parts[0], flags=re.M)
    return before + separator + ''.join(parts)


if __name__ == '__main__':
    directory, webroot = sys.argv[1:]
    if not pathlib.Path(webroot).is_absolute() or any(byte in webroot for byte in '\r\n,'):
        raise SystemExit('Invalid certificate webroot')
    for renewal in pathlib.Path(directory).glob('*.conf'):
        text = renewal.read_text()
        updated = rebind(text, webroot)
        if text != updated:
            renewal.write_text(updated)
