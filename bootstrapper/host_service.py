"""Framed native adapter transport for repository-owned Nest host services."""
import json
from pathlib import Path
import subprocess


def invoke(entry, request, dispatch, error_type, active_error=None):
    retained = Path('/opt/system-bootstrapper-runtime/bin/node')
    node = str(retained.resolve()) if retained.is_file() else 'node'
    child = subprocess.Popen([node, str(Path(__file__).resolve().parent.parent / 'operations/dist/host' / entry)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        child.stdin.write(json.dumps(request) + '\n')
        child.stdin.flush()
        while True:
            raw = child.stdout.readline(16 * 1024 ** 2 + 1)
            if not raw.endswith('\n') or len(raw) > 16 * 1024 ** 2:
                raise error_type('host-native-port-disconnected')
            message = json.loads(raw)
            if message.get('complete'):
                child.wait(timeout=10)
                if message.get('error'):
                    raise (active_error if active_error and message.get('activeJobs') else error_type)(message['error'])
                if child.returncode:
                    raise error_type('host-service-runtime-failed')
                return message.get('value')
            try:
                response = {'value': dispatch(message.get('method'), message.get('args', []))}
            except Exception as error:
                response = {'error': str(error) if isinstance(error, error_type) else 'host-native-port-failed'}
            child.stdin.write(json.dumps(response) + '\n')
            child.stdin.flush()
    finally:
        child.stdin.close()
        child.stdout.close()
        if child.poll() is None:
            child.kill()
            child.wait()
