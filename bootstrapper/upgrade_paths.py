"""Reviewed public transition graph, shared with the offline Wizard guide."""
import json
from pathlib import Path
import re

SEMVER = re.compile(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z')
STEPS = ['prerequisites', 'backup', 'preflight', 'apply', 'verify', 'recovery']


def validate(value):
    if value.get('format') != 'system-upgrade-paths-v1' or not isinstance(value.get('versions'), list):
        raise ValueError('invalid-upgrade-metadata')
    versions = value['versions']
    if not versions or len(set(versions)) != len(versions) or not all(isinstance(v, str) and SEMVER.fullmatch(v) for v in versions):
        raise ValueError('invalid-upgrade-versions')
    if versions != sorted(versions, key=lambda version: tuple(map(int, version.split('.')))):
        raise ValueError('upgrade-versions-must-be-in-ascending-order')
    pairs = set()
    for row in value.get('transitions', []):
        pair = (row.get('from'), row.get('to'))
        if (pair in pairs or not all(v in versions for v in pair) or
                tuple(map(int, pair[0].split('.'))) >= tuple(map(int, pair[1].split('.'))) or
                row.get('kind') != 'controller-wizard' or row.get('databaseMigration') is not False or
                row.get('serviceImagesPreserved') is not True or row.get('services') != ['controller', 'Wizard'] or
                type(row.get('minimumFreeGiB')) is not int or row['minimumFreeGiB'] < 8 or
                row.get('requiredStage') != 'public-release-upgrade-' + pair[0].replace('.', '-') + '-to-' + pair[1].replace('.', '-') or
                row.get('steps') != STEPS):
            raise ValueError('invalid-or-unimplemented-upgrade-transition')
        pairs.add(pair)
    return value


def load(filename=Path(__file__).with_name('upgrade-paths.json')):
    return validate(json.loads(Path(filename).read_bytes()))


def path(graph, source, target):
    validate(graph)
    if source not in graph['versions'] or target not in graph['versions']:
        return {'status': 'unknown', 'transitions': []}
    if source == target:
        return {'status': 'unnecessary', 'transitions': []}
    queue, seen = [(source, [])], {source}
    while queue:
        current, steps = queue.pop(0)
        for edge in graph['transitions']:
            if edge['from'] != current:
                continue
            route = [*steps, edge]
            if edge['to'] == target:
                return {'status': 'supported', 'transitions': route}
            if edge['to'] not in seen:
                seen.add(edge['to'])
                queue.append((edge['to'], route))
    return {'status': 'unsupported', 'transitions': []}
