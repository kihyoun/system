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


def load_manifest(directory, checkout, expected_sha=None, checksums_only=False, manifest_bytes=None):
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink(), 'recovery-directory-must-not-be-symlink')
    require((directory / 'images').is_dir() and not (directory / 'images').is_symlink(),
            'images-directory-must-not-be-symlink')
    directory = directory.resolve(strict=True)
    path = directory / 'images.json'
    require(path.is_file() and not path.is_symlink(), 'manifest-must-be-regular-file')
    if expected_sha:
        require(re.fullmatch(r'[0-9a-f]{64}', expected_sha) and sha(path) == expected_sha,
                'manifest-checksum-mismatch')
    manifest = json.loads(path.read_bytes() if manifest_bytes is None else manifest_bytes)
    require(isinstance(manifest, dict), 'invalid-manifest')
    for key in ('archives', 'publicImages'):
        require(isinstance(manifest.get(key), list), 'invalid-manifest-' + key)
    require(bool(manifest['archives']), 'manifest-has-no-archives')
    files, ids, tags = set(), set(), {}
    for archive in manifest['archives']:
        require(isinstance(archive, dict), 'invalid-archive')
        name = archive.get('file')
        require(isinstance(name, str) and re.fullmatch(r'images/[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz', name),
                'unexpected-archive-path')
        filename = directory / name
        require(filename.resolve().parent == (directory / 'images').resolve() and not filename.is_symlink(),
                'archive-escapes-images-directory')
        require(name not in files and filename.is_file(), 'duplicate-or-missing-archive')
        files.add(name)
        require(re.fullmatch(r'[0-9a-f]{64}', archive.get('sha256', '')) is not None,
                'invalid-archive-checksum')
        require(sha(filename) == archive['sha256'], 'archive-checksum-mismatch')
        if not checksums_only:
            require(image_id(archive.get('imageId')), 'archive-image-id-required')
            ids.add(archive['imageId'])
    for image in manifest['publicImages']:
        require(isinstance(image, dict) and reference(image.get('reference')) and
                re.search(r'@sha256:[0-9a-f]{64}$', image['reference']) and local_alias(image.get('tag')),
                'public-image-must-be-digest-pinned')
        if image.get('imageId') is not None:
            require(image_id(image['imageId']), 'invalid-public-image-id')
        alias = canonical_selector(image['tag'])
        require(alias not in tags, 'duplicate-image-alias')
        tags[alias] = image.get('imageId', image['reference'])
    if checksums_only:
        return manifest
    require(isinstance(manifest.get('localImages'), list) and bool(manifest['localImages']),
            'local-image-aliases-required')
    for image in manifest['localImages']:
        require(isinstance(image, dict) and local_alias(image.get('tag')) and image_id(image.get('imageId')),
                'invalid-local-image')
        require(image['imageId'] in ids, 'local-alias-has-no-declared-archive')
        alias = canonical_selector(image['tag'])
        require(alias not in tags, 'duplicate-image-alias')
        tags[alias] = image['imageId']
    commit, tree, wizard = (manifest.get(key) for key in ('sourceCommit', 'sourceTree', 'wizardSourceRevision'))
    require(all(git_id(value) for value in (commit, tree, wizard)), 'recorded-source-identities-required')
    checkout = str(Path(checkout).resolve(strict=True))
    actual_tree = run(['git', '-C', checkout, 'rev-parse', commit + '^{tree}']).decode().strip()
    require(actual_tree == tree, 'recorded-source-tree-mismatch')
    if manifest.get('deployedCodeTree') is not None:
        require(manifest['deployedCodeTree'] == tree, 'deployed-source-tree-mismatch')
    gitlink = run(['git', '-C', checkout, 'ls-tree', commit, 'wizard']).decode().strip()
    require(gitlink == '160000 commit ' + wizard + '\twizard', 'recorded-wizard-gitlink-mismatch')
    controller = manifest.get('currentController', {})
    require(isinstance(controller, dict) and controller.get('imageId') in ids and
            controller.get('reference') in {image['tag'] for image in manifest['localImages']} and
            tags.get(canonical_selector(controller['reference'])) == controller.get('imageId'), 'declared-controller-required')
    require(controller.get('sourceCommit') == commit and controller.get('sourceTree') == tree,
            'controller-source-mismatch')
    matches = [row for row in manifest['archives'] if row['imageId'] == controller['imageId']]
    require(len(matches) == 1 and matches[0].get('sourceCommit') == commit and
            matches[0].get('sourceTree') == tree and matches[0].get('wizardSourceRevision') == wizard,
            'controller-archive-source-mismatch')
    return manifest


def validate_selected_images(manifest, configuration):
    keys = ['BOOTSTRAPPER_IMAGE', 'NGINX_IMAGE', 'GITLAB_IMAGE', 'GITLAB_RUNNER_IMAGE',
            'WIZARD_ENABLE', 'WIZARD_IMAGE']
    script = 'set -e; source "$1"; ' + ''.join(
        'printf "%s\\0" "${' + key + '-}"; ' for key in keys)
    values = run(['bash', '-c', script, 'read-image-selectors', str(configuration)]).split(b'\0')
    require(len(values) == len(keys) + 1, 'image-selector-format')
    selected = dict(zip(keys, (value.decode() for value in values[:-1])))
    for key, fallback in [('BOOTSTRAPPER_IMAGE', 'system_bootstrapper'), ('NGINX_IMAGE', 'nginx'),
                          ('GITLAB_IMAGE', ''), ('GITLAB_RUNNER_IMAGE', '')]:
        value = selected[key] or fallback
        declared = declared_image(manifest, value)
        require(declared is not None, 'saved-image-is-not-declared-in-manifest')
        if key == 'BOOTSTRAPPER_IMAGE':
            require(declared.get('imageId') == manifest['currentController']['imageId'],
                    'saved-controller-is-not-declared-current-controller')
    if selected['WIZARD_ENABLE'] == 'true':
        value = selected['WIZARD_IMAGE']
        candidates = [row.get('imageRef') for row in manifest['archives']]
        candidates += [row['reference'] for row in manifest['publicImages']]
        candidates += [manifest['currentController'].get('productionWizardReference')]
        require(declared_image(manifest, value) is not None or value in candidates,
                'saved-wizard-image-is-not-declared')


def inspect_image(value):
    rows = json.loads(run(['docker', '--host=unix:///var/run/docker.sock', 'image', 'inspect', value]))
    require(len(rows) == 1, 'unexpected-image-inspection')
    return rows[0]


def restore_images(directory, manifest):
    for archive in manifest['archives']:
        # Stream decompression; never materialize another full archive on root disk.
        unpack = subprocess.Popen(['gzip', '-dc', str(Path(directory) / archive['file'])], stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL)
        loaded = None
        try:
            loaded = subprocess.Popen(['docker', '--host=unix:///var/run/docker.sock', 'load'], stdin=unpack.stdout,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            unpack.stdout.close()
            require(loaded.wait(timeout=budget(900)) == 0 and unpack.wait(timeout=budget(30)) == 0,
                    'archive-load-failed')
        except subprocess.TimeoutExpired:
            raise RecoveryError('archive-load-timeout') from None
        finally:
            for process in (loaded, unpack):
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)
        require(inspect_image(archive['imageId'])['Id'] == archive['imageId'], 'loaded-image-id-mismatch')
    for image in manifest['localImages']:
        run(['docker', '--host=unix:///var/run/docker.sock', 'tag', image['imageId'], image['tag']])
        require(inspect_image(image['tag'])['Id'] == image['imageId'], 'local-image-alias-mismatch')
    for image in manifest['publicImages']:
        try:
            loaded = inspect_image(image['reference'])
        except RecoveryError:
            run(['docker', '--host=unix:///var/run/docker.sock', 'pull', image['reference']])
            loaded = inspect_image(image['reference'])
        require(canonical_digest(image['reference']) in loaded.get('RepoDigests', []), 'public-image-digest-mismatch')
        if image.get('imageId'):
            require(loaded['Id'] == image['imageId'], 'public-image-id-mismatch')
        run(['docker', '--host=unix:///var/run/docker.sock', 'tag', image['reference'], image['tag']])


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
