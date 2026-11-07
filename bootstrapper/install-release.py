#!/usr/bin/env python3
"""Start a fresh installation from a reviewed, immutable public image pair.

Images are pulled and checked against this clean checkout before native startup.
This does not restore existing data or prove that an arbitrary image is trusted;
the operator supplies the accepted public release digests independently.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
GUARD_DIRECTORY = Path('/run/system-bootstrapper')
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
STORAGE_KEYS = ('PERSISTENCE_MODE', 'PERSISTENT_MOUNT', 'PERSISTENT_DIR', 'PERSISTENT_UUID')
IMAGE = re.compile(r'(?:docker\.io/)?([a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*)@sha256:([a-f0-9]{64})')


class ReleaseError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def run(arguments, *, environment=None, timeout=300, visible=False):
    if environment is None:
        environment = dict(os.environ, DOCKER_HOST='unix:///var/run/docker.sock')
        for key in ('DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
            environment.pop(key, None)
    try:
        result = subprocess.run(arguments, env=environment, check=True, timeout=timeout,
                                stdout=None if visible else subprocess.PIPE,
                                stderr=None if visible else subprocess.PIPE)
        return b'' if visible else result.stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        raise ReleaseError('command-failed:' + Path(arguments[0]).name) from None


def reference(value):
    require(isinstance(value, str) and len(value) <= 300 and IMAGE.fullmatch(value),
            'public-dockerhub-digest-required')
    require(not value.startswith('localhost/'), 'public-dockerhub-digest-required')
    return 'docker.io/' + IMAGE.fullmatch(value).group(1) + '@sha256:' + IMAGE.fullmatch(value).group(2)


def source_identity(checkout):
    checkout = Path(checkout)
    require(not run(['git', '-C', str(checkout), 'status', '--porcelain',
                     '--untracked-files=all', '--ignore-submodules=none']).strip(),
            'release-checkout-is-modified')
    commit = run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).decode().strip()
    tree = run(['git', '-C', str(checkout), 'rev-parse', 'HEAD^{tree}']).decode().strip()
    gitlink = run(['git', '-C', str(checkout), 'ls-tree', 'HEAD', 'wizard']).decode().strip()
    match = re.fullmatch(r'160000 commit ([a-f0-9]{40})\twizard', gitlink)
    require(re.fullmatch(r'[a-f0-9]{40}', commit) and re.fullmatch(r'[a-f0-9]{40}', tree)
            and match, 'release-source-identities-required')
    return {'sourceCommit': commit, 'sourceTree': tree, 'wizardSourceRevision': match.group(1)}


def private_file(path):
    value = Path(path)
    require(value.is_file() and not value.is_symlink(), 'private-file-must-be-regular')
    attributes = value.stat()
    require(attributes.st_uid == 0 and stat.S_IMODE(attributes.st_mode) == 0o600,
            'private-file-must-be-root-owned-mode-0600')


def write_private(path, data):
    path = Path(path)
    if path.exists() or path.is_symlink():
        private_file(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def storage(persistence, checkout):
    persistence = Path(persistence)
    require(persistence.is_absolute() and persistence.resolve() != Path('/'), 'absolute-selector-path-required')
    require(not persistence.is_symlink(), 'storage-selector-must-not-be-symlink')
    # An absent selector deliberately selects the ordinary local-data defaults.
    files = []
    if persistence.exists():
        private_file(persistence)
        files.append(str(persistence))
    script = 'set -eu; set -a; for file in "$@"; do source "$file"; done; '
    script += ''.join('printf "%s\\0" "${' + key + '-}"; ' for key in STORAGE_KEYS)
    raw = run(['bash', '-c', script, 'read-storage', *files, str(checkout / 'bootstrapper/storage-env.sh')])
    values = raw.split(b'\0')
    require(len(values) == len(STORAGE_KEYS) + 1 and values[-1] == b'', 'invalid-storage-selectors')
    selected = dict(zip(STORAGE_KEYS, (value.decode() for value in values[:-1])))
    environment = dict(os.environ, **selected, PERSISTENCE_CHECK_ONLY='1')
    run(['bash', str(checkout / 'bootstrapper/persistence.sh')], environment=environment)
    root = Path(selected['PERSISTENT_DIR'])
    require(root.is_absolute() and root.resolve() == root and root != Path('/'), 'unsafe-live-data-path')
    return selected, root


def fresh(root, checkout):
    root, checkout = Path(root), Path(checkout)
    require(not (root / 'configuration/.docker.env').exists()
            and not (root / 'configuration/.docker.env').is_symlink()
            and not (checkout / 'system/.docker.env').exists()
            and not (checkout / 'system/.docker.env').is_symlink(), 'fresh-install-saved-configuration-exists')
    for relative in ('gitlab/config', 'gitlab/logs', 'gitlab/data'):
        directory = root / relative
        require(not directory.is_symlink(), 'fresh-install-unsafe-service-directory')
        require(not directory.exists() or directory.is_dir() and not any(directory.iterdir()),
                'fresh-install-gitlab-data-exists')
    for relative in ('configuration/.storage-operation-lock', 'configuration/.gitlab-upgrade-lock',
                     'gitlab/data/.system-bootstrapper-restore-incomplete'):
        path = root / relative
        require(not path.exists() and not path.is_symlink(), 'unfinished-operation-blocks-fresh-install')


def no_existing_services():
    for selector in ('name=^/system_bootstrapper_1$', 'label=com.docker.compose.project=system'):
        require(not run([*DOCKER, 'container', 'ls', '--all', '--filter', selector, '--format', '{{.ID}}']).strip(),
                'fresh-install-existing-system-container')
    # Compose reuses existing named volumes without changing their bind device.
    # A fresh-data selection must not accidentally start on an older volume set.
    require(not run([*DOCKER, 'volume', 'ls', '--filter', 'name=^system_', '--format', '{{.Name}}']).strip(),
            'fresh-install-existing-system-volumes')


def checked_image(selected, identity, *, wizard=False):
    selected = reference(selected)
    run([*DOCKER, 'pull', selected], timeout=1800, visible=True)
    try:
        rows = json.loads(run([*DOCKER, 'image', 'inspect', selected]))
    except (ValueError, TypeError):
        raise ReleaseError('invalid-release-image-inspection') from None
    require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict),
            'invalid-release-image-inspection')
    image = rows[0]
    digests = image.get('RepoDigests') or []
    # Docker may omit its default Docker Hub hostname in RepoDigests.
    require(selected in {reference(value) for value in digests if isinstance(value, str) and IMAGE.fullmatch(value)},
            'release-pulled-repository-digest-mismatch')
    image_id = image.get('Id', '')
    require(isinstance(image_id, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', image_id), 'release-image-id-required')
    require(image.get('Os') == 'linux' and image.get('Architecture') == 'amd64',
            'release-platform-must-be-linux-amd64')
    labels = (image.get('Config') or {}).get('Labels') or {}
    require(isinstance(labels, dict), 'release-image-labels-required')
    candidate_job = labels.get('org.system-bootstrapper.test-job', '')
    require(isinstance(candidate_job, str) and re.fullmatch(r'[1-9][0-9]*', candidate_job)
            and int(candidate_job) <= 2 ** 53 - 1, 'release-candidate-job-required')
    require(labels.get('org.opencontainers.image.revision') ==
            identity['wizardSourceRevision' if wizard else 'sourceCommit'], 'release-image-source-mismatch')
    if wizard:
        require(labels.get('org.system-bootstrapper.source-revision') == identity['sourceCommit'],
                'wizard-release-system-source-mismatch')
    return {'reference': selected, 'imageId': image_id, 'candidateJobId': int(candidate_job),
            'platform': 'linux/amd64'}


def install(args, checkout=ROOT):
    require(os.geteuid() == 0, 'run-release-installer-as-root')
    controller, wizard = reference(args.controller), reference(args.wizard)
    identity = source_identity(checkout)
    selected, root = storage(args.persistence_env, checkout)
    fresh(root, checkout)
    require(not root.is_relative_to(Path(checkout).resolve()), 'live-data-must-be-outside-checkout')
    # Share the native replacement-host initialization guard. Persistent service
    # startup additionally acquires its normal live-state/TLS leases internally.
    guard_dir = GUARD_DIRECTORY
    guard_dir.mkdir(mode=0o700, exist_ok=True)
    require(not guard_dir.is_symlink(), 'unsafe-host-initialization-lock-directory')
    guard = os.open(guard_dir / 'initialize.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReleaseError('another-host-initialization-is-running') from None
        fresh(root, checkout)
        if args.install_host:
            run(['bash', str(checkout / 'bootstrapper/install.sh')], timeout=1800, visible=True)
        no_existing_services()
        pair = {'controller': checked_image(controller, identity),
                'wizard': checked_image(wizard, identity, wizard=True)}
        require(pair['controller']['candidateJobId'] == pair['wizard']['candidateJobId'],
                'release-images-must-share-one-accepted-candidate-job')
        require(source_identity(checkout) == identity, 'release-source-changed-during-download')
        fresh(root, checkout)
        no_existing_services()
        environment = dict(os.environ, **selected, PERSISTENCE_ENV_FILE=str(args.persistence_env),
                           DOCKER_HOST='unix:///var/run/docker.sock')
        for key in ('DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'PERSISTENCE_CHECK_ONLY'):
            environment.pop(key, None)
        run(['bash', str(checkout / 'bootstrapper/persistence.sh')], environment=environment)
        profile = root / 'configuration/.release-images.env'
        payload = f'BOOTSTRAPPER_IMAGE={controller}\nWIZARD_IMAGE={wizard}\n'.encode()
        if profile.exists() or profile.is_symlink():
            private_file(profile)
            require(profile.read_bytes() == payload, 'fresh-release-selection-already-differs')
        write_private(profile, payload)
        receipt = root / 'configuration/.release-images.json'
        result = {'schemaVersion': 1, **identity, 'images': pair, 'status': 'selected',
                  'selectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        write_private(receipt, (json.dumps(result, indent=2) + '\n').encode())
        persistence = Path(args.persistence_env)
        if not persistence.exists():
            require(not persistence.parent.is_symlink(), 'unsafe-storage-selector-directory')
            persistence.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            text = ''.join(key + '=' + shlex.quote(value) + '\n' for key, value in selected.items())
            # Native defaults contain no shell syntax; an existing operator file
            # is preserved unchanged, including explicit networking settings.
            write_private(persistence, text.encode())
        environment['SYSTEM_BOOTSTRAPPER_SKIP_BUILD'] = '1'
        try:
            run(['bash', str(checkout / 'start.sh')], environment=environment, timeout=1800, visible=True)
        except ReleaseError:
            result['status'] = 'startup-failed'
            write_private(receipt, (json.dumps(result, indent=2) + '\n').encode())
            raise
        result['status'] = 'startup-requested'
        write_private(receipt, (json.dumps(result, indent=2) + '\n').encode())
        print('Public release startup requested. Complete first setup in the Wizard; service readiness is separate.')
        return result
    finally:
        os.close(guard)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controller', required=True, help='Accepted Docker Hub controller repository@sha256:digest.')
    parser.add_argument('--wizard', required=True, help='Matching accepted Docker Hub Wizard repository@sha256:digest.')
    parser.add_argument('--persistence-env', type=Path, default=Path('/etc/system-bootstrapper/persistence.env'))
    parser.add_argument('--install-host', action='store_true', help='Run the committed Ubuntu host dependency installer.')
    args = parser.parse_args()
    try:
        install(args)
    except (ReleaseError, OSError, UnicodeError, ValueError) as error:
        print('Public release installation: ' + (str(error) if isinstance(error, ReleaseError)
                                                else 'invalid-private-input-or-filesystem'), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
