#!/usr/bin/env python3
"""Compatibility exec: the precompiled TypeScript guardian owns child lifetime."""
import os
from pathlib import Path
import sys

if __name__ == '__main__':
    entry = Path(__file__).resolve().parent.parent / 'operations/dist/host/guardian.js'
    os.execvp('node', ['node', str(entry), *sys.argv[1:]])
