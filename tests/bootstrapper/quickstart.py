#!/usr/bin/env python3
"""Compatibility test runner for the shared Node Quickstart acceptance checks."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
if __name__ == '__main__':
    raise SystemExit(subprocess.call(['node', '--test', 'operations/tests/host-quickstart.test.cjs'], cwd=ROOT))
