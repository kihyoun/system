"""Reviewed public transition graph, shared with the offline Wizard guide."""
import json
from pathlib import Path
import re

SEMVER = re.compile(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z')
STEPS = ['prerequisites', 'backup', 'preflight', 'apply', 'verify', 'recovery']


def validate(value):
    from recovery import host_operation, RecoveryError
    try:
        return host_operation('validateUpgradeGraph', value)
    except RecoveryError as error:
        raise ValueError(str(error)) from None


def load(filename=Path(__file__).with_name('upgrade-paths.json')):
    return validate(json.loads(Path(filename).read_bytes()))


def path(graph, source, target):
    from recovery import host_operation, RecoveryError
    try:
        return host_operation('upgradePath', graph, source, target)
    except RecoveryError as error:
        raise ValueError(str(error)) from None
