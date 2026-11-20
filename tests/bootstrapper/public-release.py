"""Compatibility test entry: execute the migrated TypeScript host contracts."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
if __name__ == '__main__':
    sys.exit(subprocess.call(['node', '--test', str(ROOT / 'operations/tests/host-install.test.cjs')], cwd=ROOT))
