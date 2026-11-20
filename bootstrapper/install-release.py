#!/usr/bin/env python3
"""Compatibility entry for the compiled TypeScript host installer.

The Node runtime and compiled operations package must be prepared before offline
maintenance. No dependency installation or compilation takes place here.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / 'operations/dist/host/entry.js'
RETAINED_NODE = Path('/opt/system-bootstrapper-runtime/bin/node')
NODE = str(RETAINED_NODE.resolve()) if RETAINED_NODE.is_file() else 'node'
if RETAINED_NODE.is_file():
    os.environ['PATH'] = str(RETAINED_NODE.parent) + os.pathsep + os.environ.get('PATH', '')
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']


class ReleaseError(RuntimeError):
    pass


def invoke(operation, *arguments, deadline=None):
    result = subprocess.run([NODE, str(ENTRY), '--compatibility'],
                            input=json.dumps({'operation': operation, 'arguments': arguments, **({'deadline': deadline} if deadline is not None else {})}, default=str),
                            capture_output=True, text=True)
    try:
        value = json.loads(result.stdout)
    except ValueError:
        raise ReleaseError('compiled-host-operations-runtime-required') from None
    if result.returncode or 'error' in value:
        raise ReleaseError(value.get('error', 'host-operation-failed'))
    return value['value']


def run(arguments, *, environment=None, timeout=300, visible=False):
    # Native transport retained for Python update consumers; decisions are TS.
    environment = dict(os.environ if environment is None else environment,
                       DOCKER_HOST='unix:///var/run/docker.sock')
    for key in ('DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
        environment.pop(key, None)
    try:
        return subprocess.run(arguments, env=environment, check=True, timeout=timeout,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        raise ReleaseError('command-failed:' + Path(arguments[0]).name) from None


def reference(value):
    return invoke('reference', value)


def source_identity(checkout):
    return invoke('source', checkout)


def private_file(filename):
    return invoke('privateFile', filename)


def write_private(filename, data):
    return invoke('writePrivate', filename, base64.b64encode(data).decode())


def fresh(root, checkout):
    return invoke('fresh', root, checkout)


def storage(persistence, checkout):
    value = invoke('storage', persistence, checkout)
    return value['selected'], Path(value['root'])


def no_existing_services():
    return invoke('noExistingServices')


def checked_image(selected, identity, *, wizard=False):
    selected = reference(selected)
    run([*DOCKER, 'pull', selected], timeout=1800, visible=True)
    try:
        rows = json.loads(run([*DOCKER, 'image', 'inspect', selected]))
    except (ValueError, TypeError):
        raise ReleaseError('invalid-release-image-inspection') from None
    return invoke('checkedImage', selected, identity, rows, wizard)


def accepted_metadata(filename, identity, controller, wizard):
    return invoke('acceptedMetadata', filename, identity, controller, wizard)


def install(args, checkout=ROOT):
    return invoke('install', {'controller': args.controller, 'wizard': args.wizard,
        'persistenceEnv': str(args.persistence_env), 'installHost': args.install_host,
        'releaseMetadata': str(args.release_metadata) if getattr(args, 'release_metadata', None) else None}, checkout)


if __name__ == '__main__':
    os.execvp(NODE, [NODE, str(ENTRY), *sys.argv[1:]])
