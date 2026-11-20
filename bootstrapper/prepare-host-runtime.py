#!/usr/bin/env python3
"""Prepare the same pinned nvm/Node and accepted code used by fresh Quickstart."""
import argparse
import json
import os
from pathlib import Path
import sys
import types


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True, type=Path)
    parser.add_argument('--release-metadata', required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0 or not args.checkout.is_absolute() or args.checkout.resolve() != args.checkout:
        raise ValueError('Root and an explicit canonical checkout are required.')
    source = Path(__file__).with_name('quickstart.sh').read_text().split("<<'SYSTEM_QUICKSTART_PY'\n", 1)[1].rsplit('\nSYSTEM_QUICKSTART_PY', 1)[0]
    quick = types.ModuleType('system_quickstart_runtime')
    exec(compile(source, 'quickstart-runtime', 'exec'), quick.__dict__)
    quick.CHECKOUT = args.checkout
    selected = json.loads(args.release_metadata.read_bytes())
    quick.require(selected.get('format') == 'system-accepted-release-v1' and
                  selected.get('acceptance', {}).get('requiredChecksPassed') is True and
                  selected.get('acceptance', {}).get('controllerWizardSameAttempt') is True,
                  'Accepted paired release metadata required.')
    quick.prepare_host_runtime(selected)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Host runtime preparation failed. Preserve the runtime directory and inspect the verified release inputs before retrying.', file=sys.stderr)
        sys.exit(1)
