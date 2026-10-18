"""Compatibility entrypoint for the completed Seed recovery regressions."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name('recovery-contract.py')), run_name='__main__')
