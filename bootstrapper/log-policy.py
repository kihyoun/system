#!/usr/bin/env python3
"""Print or verify the bounded logging contract without changing containers or Docker."""
import argparse
import json
import os
import re
import subprocess


def policy(size='10m', files='3'):
    if not re.fullmatch(r'[1-9][0-9]*[kmgKMG]', size):
        raise ValueError('SYSTEM_LOG_MAX_SIZE must be a positive integer with k, m or g units.')
    if not re.fullmatch(r'[1-9][0-9]*', files) or int(files) > 100:
        raise ValueError('SYSTEM_LOG_MAX_FILES must be from 1 to 100.')
    return {'Type': 'json-file', 'Config': {'max-size': size.lower(), 'max-file': files}}


def verify(container, expected):
    result = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'container', 'inspect',
                             '--format', '{{json .HostConfig.LogConfig}}', container],
                            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    actual = json.loads(result.stdout)
    matches = actual.get('Type') == expected['Type'] and all(
        str(actual.get('Config', {}).get(key, '')).lower() == value for key, value in expected['Config'].items())
    return {'container': container, 'matches': matches, 'actual': actual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-size', default=os.environ.get('SYSTEM_LOG_MAX_SIZE', '10m'))
    parser.add_argument('--max-files', default=os.environ.get('SYSTEM_LOG_MAX_FILES', '3'))
    parser.add_argument('containers', nargs='*', help='Exact container names or IDs to inspect; no recreation or data deletion')
    args = parser.parse_args()
    try:
        expected = policy(args.max_size, args.max_files)
        if any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', name) for name in args.containers):
            raise ValueError('Supply exact container names or IDs, not selectors or options.')
        checked = [verify(name, expected) for name in args.containers]
        ok = all(item['matches'] for item in checked)
        print(json.dumps({'schemaVersion': 1, 'expected': expected, 'containers': checked, 'ok': ok,
                          'retention': 'size-and-file-count; no maximum age guarantee'}, indent=2))
        return 0 if ok else 1
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Docker stderr can contain unrelated private daemon details.
        print(json.dumps({'ok': False, 'error': 'Unable to validate logging policy: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
