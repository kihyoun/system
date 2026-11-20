#!/usr/bin/env python3
"""Declared retained-volume images and source validation. No service-data writes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


class RecoveryError(RuntimeError):
    pass


def require(condition, label):
    if not condition:
        raise RecoveryError(label)


OPERATION_DEADLINE = None


def budget(seconds):
    if OPERATION_DEADLINE is None:
        return seconds
    remaining = OPERATION_DEADLINE - time.monotonic()
    require(remaining > 0, 'operation-readiness-deadline-expired')
    return min(seconds, remaining)


def run(arguments, **kwargs):
    try:
        return subprocess.run(arguments, capture_output=True, check=True,
                              timeout=budget(kwargs.pop('timeout', 300)), **kwargs).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        raise RecoveryError('command-failed:' + arguments[0]) from None


def sha(path):
    with Path(path).open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
        return digest.hexdigest()


def image_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r'sha256:[0-9a-f]{64}', value))


def local_alias(value):
    return reference(value) and '@' not in value and not value.startswith('sha256:')


def canonical_digest(value):
    """Docker RepoDigests use repository@digest, without an optional input tag."""
    repository, separator, digest = value.rpartition('@')
    require(separator == '@' and image_id(digest), 'invalid-repository-digest')
    last_slash = repository.rfind('/')
    last_colon = repository.rfind(':')
    if last_colon > last_slash:
        repository = repository[:last_colon]
    require(bool(repository), 'invalid-repository-digest')
    return repository + '@' + digest


def git_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[0-9a-f]{40}', value))


def reference(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@-]{0,500}', value))


def canonical_selector(value):
    """Apply Docker's implicit :latest only to an untagged repository selector."""
    require(reference(value), 'invalid-image-selector')
    # A colon in the registry host/port is not an image tag. Digest selectors
    # already identify their content and must never acquire an implicit tag.
    if '@' in value or ':' in value.rsplit('/', 1)[-1]:
        return value
    return value + ':latest'


def declared_image(manifest, selected):
    declared = {canonical_selector(row['tag']): row
                for row in manifest['publicImages'] + manifest['localImages']}
    declared.update({canonical_selector(row['reference']): row for row in manifest['publicImages']})
    return declared.get(canonical_selector(selected))


def host_operation(operation, *arguments):
    import importlib.util
    spec = importlib.util.spec_from_file_location('host_operations_compatibility', Path(__file__).with_name('install-release.py'))
    host = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(host)
    try:
        return host.invoke(operation, *arguments, deadline=(time.time() + budget(float('inf'))) * 1000 if OPERATION_DEADLINE is not None and operation not in ('upgradePhase', 'failedStoppedController', 'inspectServiceRows', 'runtimeImageSelectors', 'verifyImageInspections', 'validateUpgradeGraph', 'upgradePath') else None)
    except host.ReleaseError as error:
        raise RecoveryError(str(error)) from None


def load_manifest(directory, checkout, expected_sha=None, checksums_only=False, manifest_bytes=None):
    return host_operation('loadManifest', directory, checkout, expected_sha, checksums_only,
                          manifest_bytes.decode() if manifest_bytes is not None else None)


def validate_selected_images(manifest, configuration):
    return host_operation('validateSelected', manifest, configuration)


def inspect_image(value):
    rows = json.loads(run(['docker', '--host=unix:///var/run/docker.sock', 'image', 'inspect', value]))
    require(len(rows) == 1, 'unexpected-image-inspection')
    return rows[0]


def recovery_alias(value):
    return isinstance(value, str) and re.fullmatch(r'system-bootstrapper-recovery:[a-f0-9]{64}', value) is not None


def recovered_image(config, reference, image):
    """Persistent proof for deliberately selected, previously verified aliases."""
    path = config['_root'] / 'configuration/.release-images.recovered.json'
    require(path.is_file() and not path.is_symlink() and path.stat().st_uid == 0 and
            not path.stat().st_mode & 0o077 and path.stat().st_size <= 16384,
            'private-recovered-image-receipt-required')
    value = json.loads(path.read_bytes())
    require(value.get('format') == 'system-public-recovered-images-v1' and
            value.get('configurationSha256') == sha(config['_main']), 'recovered-image-configuration-changed')
    return any(row.get('reference') == reference and row.get('imageId') == image
               for row in value.get('images', {}).values())


def restore_retained_images(directory, descriptors, expected):
    """Load independently retained payloads bound to the paired checkpoint.

    Docker save/load does not retain RepoDigests. Never manufacture one: bind
    each original selector to an owned alias only after verifying the archived
    bytes and the checkpoint's immutable image ID. The paired rollback records
    deliberate selector substitutions so old startup code can use them too.
    """
    directory = Path(directory)
    selections = {}
    require(set(descriptors) == set(expected), 'retained-image-role-set-mismatch')
    for role, selected in expected.items():
        row = descriptors[role]
        relative = row.get('file', '')
        path = directory / relative
        require(re.fullmatch(r'images/controller-[a-f0-9-]+\.tar\.gz', relative) and
                path.is_file() and not path.is_symlink() and not path.parent.is_symlink() and
                path.resolve() == path and not path.stat().st_mode & 0o077 and
                re.fullmatch(r'[a-f0-9]{64}', row.get('sha256', '')) and
                row.get('imageId') == selected['imageId'] and image_id(row['imageId']) and
                sha(path) == row['sha256'], 'previous-image-archive-changed')
        run(['docker', '--host=unix:///var/run/docker.sock', 'image', 'load', '--input', str(path)], timeout=600)
        require(inspect_image(row['imageId'])['Id'] == selected['imageId'], 'loaded-image-id-mismatch')
        reference = selected.get('originalReference', selected['reference'])
        require('@sha256:' in reference and canonical_digest(reference), 'retained-public-digest-required')
        identity = hashlib.sha256((reference + row['imageId'] + row['sha256']).encode()).hexdigest()
        alias = 'system-bootstrapper-recovery:' + identity
        # The immutable checkpoint/image/archive tuple owns this exact alias.
        try:
            existing = inspect_image(alias)
        except RecoveryError:
            existing = None
        require(existing is None or existing['Id'] == selected['imageId'], 'retained-image-alias-retargeted')
        run(['docker', '--host=unix:///var/run/docker.sock', 'image', 'tag', row['imageId'], alias])
        require(inspect_image(alias)['Id'] == selected['imageId'], 'retained-image-alias-mismatch')
        selections[role] = {'reference': alias, 'originalReference': reference, 'imageId': selected['imageId'],
                            'archiveSha256': row['sha256'], 'file': relative}
    return selections


def restore_images(directory, manifest):
    return host_operation('restoreImages', directory, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['verify', 'load'])
    parser.add_argument('--directory', required=True)
    parser.add_argument('--checkout', default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('--expected-manifest-sha256')
    parser.add_argument('--configuration', help='Validate saved image selectors before loading or starting.')
    parser.add_argument('--checksums-only', action='store_true', help='Legacy archive audit only; cannot start services.')
    args = parser.parse_args()
    require(not (args.operation == 'load' and args.checksums_only), 'legacy-checksums-cannot-load-images')
    manifest = load_manifest(args.directory, args.checkout, args.expected_manifest_sha256, args.checksums_only)
    if args.configuration:
        require(not args.checksums_only, 'legacy-checksums-cannot-validate-configuration')
        validate_selected_images(manifest, args.configuration)
    if args.operation == 'load':
        restore_images(args.directory, manifest)
    print('Recovery manifest ' + ('loaded.' if args.operation == 'load' else 'verified.'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Recovery failed: ' + (str(error) if isinstance(error, RecoveryError) else type(error).__name__),
              file=__import__('sys').stderr)
        raise SystemExit(1)
