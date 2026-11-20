#!/usr/bin/env python3
"""Compatibility transport for the shared Nest runtime verification service."""
import base64
import datetime
import importlib.util
import os
from pathlib import Path
import sys
import urllib.request

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('system_recovery', HERE / 'recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
require, run = recovery.require, recovery.run
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']

def call(method, *args):
    return recovery.host_operation('runtimeVerification', method, *args)

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def settings(persistence):
    result = call('settings', str(persistence), str(HERE.parent))
    result['_root'], result['_main'] = Path(result['_root']), Path(result['_main'])
    return result

def cube(raw):
    return call('cube', base64.b64encode(raw).decode())

def origin(config, prefix):
    return call('origin', config, prefix)

def runner_count(config):
    return recovery.host_operation('runtimeRunnerCount', config)

def configuration_files(root):
    return call('files', {'_root': str(root)})

def public_manifest_absent(config):
    return call('manifestAbsent', config)

def public_images(config, services):
    return call('publicImages', config, services)

def capture(config, checkout, manifest=None, public=False, stopped_controller_id=None):
    return call('capture', config, str(checkout), public, stopped_controller_id, manifest)

def assert_baseline(config, baseline):
    return call('assertBaseline', config, baseline)

def verify_sync(config):
    return call('sync', config)

def verify_management_routes(config):
    return call('managementRoutes', config)

def verify_routes(config, services, redirect_from=None):
    return call('routes', config, services, redirect_from)

def runner_contacts(config, baseline, token_file):
    return call('runnerContacts', config, baseline, token_file)

def verify(config, baseline, checkout, token_file=None, redirect_from=None, public=False):
    return call('verify', config, baseline, {'operation':'check', 'checkout':str(checkout), 'publicImages':public,
                'tokenFile':str(token_file) if token_file else None, 'redirectFrom':redirect_from})

def write_private(path, data):
    import json
    return recovery.host_operation('writePrivate', str(path), base64.b64encode((json.dumps(data, indent=2)+'\n').encode()).decode())

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def http(url, body=None, headers=None):
    from email.message import Message
    result = call('http', url, body, headers)
    selected = Message()
    for key, value in result['headers'].items():
        selected[key] = value
    return result['status'], base64.b64decode(result['body']), selected

def failed_stopped_controller(row, expected_id):
    return recovery.host_operation('failedStoppedController', row, expected_id)


def inspect_services(config, stopped_controller_id=None):
    return call('inspectServices', config, stopped_controller_id)

def verify_images(config, manifest, services):
    return call('verifyImages', config, manifest, services)

def verify_mounts(config, services):
    return recovery.host_operation('verifyMounts', {key: str(value) for key, value in config.items()}, services)



if __name__ == '__main__':
    retained = Path('/opt/system-bootstrapper-runtime/bin/node')
    node = str(retained.resolve()) if retained.is_file() else 'node'
    os.execvp(node, [node, str(HERE / 'verify-runtime.js'), *sys.argv[1:]])
