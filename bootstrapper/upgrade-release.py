#!/usr/bin/env python3
"""Plan, explicitly apply, inspect or recover a supported official public release.

Uses only public release inputs and this installation's own API credentials.
Quickstart is for a fresh host; source pulls alone never upgrade an installation.
"""
import argparse
import base64
import host_service
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import time
import urllib.request
import zipfile
from contextlib import contextmanager

sys.dont_write_bytecode = True
import successor
from public_release import PublicReleaseAuthority, fetch
import upgrade_paths

runtime, recovery = successor.runtime, successor.recovery
require, run = successor.require, successor.run
ROOT = successor.HERE.parent
updater = importlib.util.spec_from_file_location('public_paired_updater', ROOT / 'bootstrapper/update-controller.py')
_module = importlib.util.module_from_spec(updater)
updater.loader.exec_module(_module)
updater = _module
archives = updater.module('public_upgrade_image_archives', 'record-recovery-images.py')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def directory(config, value, new=False):
    path = Path(value)
    boundary = config['_root'] / 'recovery/public-upgrades'
    require(path.is_absolute() and path == path.resolve() and boundary in path.parents and
            not path.is_symlink() and (not path.exists() if new else path.is_dir()),
            'retained-public-upgrade-directory-required')
    return path


def public_inputs(repository, version, config):
    tag = 'v' + version
    raw = fetch(repository, tag, 'system-release-' + tag + '.json')
    metadata = json.loads(raw)
    require(metadata.get('version') == version and metadata.get('tag') == tag and
            metadata.get('source', {}).get('repository') == 'https://github.com/' + repository + '.git',
            'selected-public-release-source-mismatch')
    descriptor = metadata.get('publicUpgrade', {})
    proof = fetch(repository, tag, descriptor.get('file'))
    security = json.loads((ROOT / 'gitlab/security-release.json').read_bytes())
    authority = PublicReleaseAuthority(metadata, proof, runtime.origin(config, 'GITLAB'), security)
    require(authority.graph == upgrade_paths.load(), 'checkout-and-public-upgrade-metadata-differ')
    return raw, proof, authority, security


def installed(config, repository, target=None):
    require(not recovery.recovery_alias(config['BOOTSTRAPPER_IMAGE']) and not recovery.recovery_alias(config['WIZARD_IMAGE']),
            'archive-recovered-selectors-repull-original-public-images-and-restore-checkpoint-selectors-see-upgrade-guide')
    selected = json.loads(successor.private_input(config['_root'] / 'configuration/.release-images.json'))
    version = selected.get('productRelease', {}).get('version')
    require(isinstance(version, str) and upgrade_paths.SEMVER.fullmatch(version),
            'unknown-installation-release-use-source-build-or-recovery-guide')
    if target is not None:
        selection = upgrade_paths.path(upgrade_paths.load(), version, target)
        require(selection['status'] == 'supported', 'upgrade-selection-' + selection['status'] + '-see-public-upgrade-guide')
    metadata = json.loads(fetch(repository, 'v' + version, 'system-release-v' + version + '.json'))
    require(metadata.get('version') == version and metadata.get('source', {}).get('repository') ==
            'https://github.com/' + repository + '.git' and
            all(selected.get(key) == metadata['source'].get(field) for key, field in
                [('sourceCommit', 'revision'), ('sourceTree', 'tree'), ('wizardSourceRevision', 'wizardRevision'),
                 ('sourceLayout', 'sourceLayout'), ('wizardSourceTree', 'wizardSourceTree')]),
            'installed-source-does-not-match-official-release')
    successor.verify_source_objects({'sourceRevision': metadata['source']['revision'],
        'sourceTree': metadata['source']['tree'], **{key: metadata['source'][key] for key in
            ('sourceLayout', 'wizardSourceTree', 'wizardRevision') if key in metadata['source']}}, ROOT)
    profile = successor.private_input(config['_root'] / 'configuration/.release-images.env')
    expected_profile = ''.join(key + '=' + updater.installer.reference(metadata['images'][role]['reference']) + '\n'
                               for role, key in [('controller', 'BOOTSTRAPPER_IMAGE'), ('wizard', 'WIZARD_IMAGE')]).encode()
    require(profile == expected_profile, 'modified-or-incomplete-official-release-profile')
    services = runtime.inspect_services(config)
    runtime.verify_mounts(config, services)
    runtime.public_images(config, services)
    for role, key, name in [('controller', 'BOOTSTRAPPER_IMAGE', 'system_bootstrapper_1'),
                            ('wizard', 'WIZARD_IMAGE', 'system_wizard_1')]:
        expected, retained = metadata['images'][role], selected.get('images', {}).get(role, {})
        require(updater.installer.reference(config[key]) == updater.installer.reference(expected['reference']) and
                updater.installer.reference(retained.get('reference')) == updater.installer.reference(expected['reference']) and
                retained.get('imageId') == services[name]['Image'],
                'modified-or-inconsistent-official-image-selection')
        require(services[name]['Image'] == expected['imageId'],
                'official-upgrade-requires-recorded-runtime-image-id-see-source-recovery-guide')
        image = recovery.inspect_image(config[key])
        labels = image.get('Config', {}).get('Labels', {})
        require(image['Id'] == expected['imageId'] and
                labels.get('org.opencontainers.image.revision') == metadata['source'][
                    'revision' if role == 'controller' or metadata['source'].get('sourceLayout') == 'system-monorepo-v1' else 'wizardRevision'] and
                labels.get('org.system-bootstrapper.test-job') == str(metadata['acceptance']['candidateJobId']) and
                (role != 'wizard' or labels.get('org.system-bootstrapper.source-revision') == metadata['source']['revision']),
                'installed-official-image-labels-mismatch')
    return selected, metadata


def host(metadata):
    os_release = platform.freedesktop_os_release()
    compatibility = metadata.get('compatibility', {})
    require(os_release.get('ID') == 'ubuntu' and os_release.get('VERSION_ID') in compatibility.get('versions', []) and
            platform.machine() == 'x86_64' and metadata.get('platform') == 'linux/amd64',
            'supported-Ubuntu-amd64-host-required')
    memory = int(re.search(r'^MemTotal:\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M)[1]) * 1024
    require(memory >= compatibility.get('minimumMemoryGiB', 8) * 1024 ** 3 - 512 * 1024 ** 2, 'insufficient-upgrade-memory')


def backup_target(config, filename):
    # Native preflight proves the selected backup mount/UUID/capacity. It never
    # creates a fallback when media is absent, even in --check-only mode.
    require(config.get('SEED_DIR') and config.get('SEED_MOUNT'), 'explicit-backup-filesystem-required')
    environment = dict(os.environ, PERSISTENCE_ENV_FILE=str(config['_persistence_env']))
    run(['bash', str(ROOT / 'bootstrapper/seed-operation.sh'), 'harvest', '--image', config['BOOTSTRAPPER_IMAGE'],
         '--check-only'], env=environment, timeout=300)
    path = Path(filename)
    require(path.is_absolute() and path == path.resolve() and not path.exists() and
            path.parent.is_dir() and not path.parent.is_symlink() and
            config['_root'] not in path.parents and ROOT not in path.parents and
            path.parent.stat().st_dev == Path(config['SEED_DIR']).stat().st_dev,
            'new-configuration-backup-on-selected-backup-filesystem-required')
    return path


def invoke(config, authority, security, checkpoint, metadata_file, token_file, timeout, check_only, expected_baseline=None):
    return updater.update(config, authority.release, authority.evidence, authority,
        authority.release_bytes, authority.evidence_bytes, security,
        authority.metadata['images']['controller']['reference'], checkpoint, token_file,
        timeout=timeout, check_only=check_only, wizard=authority.metadata['images']['wizard']['reference'],
        release_metadata=metadata_file, expected_baseline=expected_baseline)


def data_sample():
    script = (ROOT / 'gitlab/verify-upgrade-data.rb').read_bytes()
    raw = run([*successor.DOCKER, 'exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-'],
              input=script, timeout=300)
    value = json.loads(raw.decode().splitlines()[-1])
    require(value.get('format') == 'system-upgrade-data-sample-v1' and
            re.fullmatch(r'[a-f0-9]{64}', value.get('sha256', '')) and
            type(value.get('sampledProjects')) is int and 0 <= value['sampledProjects'] <= 10,
            'read-only-data-sample-unavailable')
    return value


def plan(args, config):
    authority = security = None
    def dispatch(method, arguments):
        nonlocal authority, security
        if method == 'publicInputs':
            raw, proof, authority, security = public_inputs(*arguments, config)
            return {'raw': base64.b64encode(raw).decode(), 'proof': base64.b64encode(proof).decode(),
                    'release': authority.release, 'metadata': authority.metadata, 'evidence': authority.evidence, 'graph': authority.graph}
        if method == 'verifyCheckout': successor.verify_checkout(authority.release, ROOT)
        elif method == 'installed': return installed(config, *arguments)[1]
        elif method == 'prerequisite': return recovery.host_operation('gitlabUpgradePrerequisite', config['_root'], arguments[0], authority.release['sourceRevision'], security)
        elif method == 'host': host(authority.metadata)
        elif method == 'syncIdle': successor.sync_idle(config)
        elif method == 'freeBytes':
            docker_root = run([*successor.DOCKER, 'info', '--format', '{{.DockerRootDir}}']).decode().strip()
            return [shutil.disk_usage(item).free for item in (config['_root'], Path(docker_root))]
        elif method == 'backupTarget': return str(backup_target(config, arguments[0]))
        elif method == 'selection': return {'json': base64.b64encode(successor.private_input(config['_main'].parent / '.release-images.json')).decode(), 'environment': base64.b64encode(successor.private_input(config['_main'].parent / '.release-images.env')).decode(), 'configurationSha256': digest(config['_main'].read_bytes())}
        elif method == 'capture': return runtime.capture(config, ROOT, public=True)
        elif method == 'invoke': invoke(config, authority, security, Path(arguments[0]), Path(arguments[1]), args.token_file, args.timeout, True)
        elif method == 'dataSample': return data_sample()
        elif method == 'now': return runtime.now()
        else: raise recovery.RecoveryError('unknown-public-upgrade-native-port')
    try:
        result = host_service.invoke('public-upgrade-plan-entry.js', {'target': args.target, 'repository': args.repository,
            'directory': str(args.plan_dir), 'backupFile': str(args.backup_file), 'gitlabCheckpoint': getattr(args, 'gitlab_checkpoint', None),
            'root': str(config['_root']), 'checkout': str(ROOT), 'backupDestination': config['SEED_DIR']}, dispatch, recovery.RecoveryError)
    except BaseException:
        host_service.invoke('public-upgrade-plan-entry.js', {'operation': 'interrupt', 'directory': str(args.plan_dir)}, dispatch, recovery.RecoveryError)
        raise
    return result['value'], result['sha256']


def sync_request(config, route, body=None):
    base = runtime.origin(config, 'SYNC')
    code, raw, _ = runtime.http(base + '/login', {'username': config['SYNC_USER'], 'password': config['SYNC_PASS']})
    require(code == 200, 'public-upgrade-sync-authentication-failed')
    token = json.loads(raw).get('accessToken')
    require(isinstance(token, str) and token, 'public-upgrade-sync-token-required')
    code, raw, _ = runtime.http(base + route, body, {'Authorization': 'Bearer ' + token})
    require(code in (200, 202), 'public-upgrade-backup-request-failed')
    return json.loads(raw)


def matching_backup(config, target, plan_value, timeout):
    status = sync_request(config, '/command/backup', {})
    operation = status.get('id')
    require(re.fullmatch(r'[a-f0-9]{32}', operation or ''), 'public-upgrade-backup-operation-required')
    successor.atomic_json(target / 'backup-operation.json', {'id': operation})
    until = time.monotonic() + timeout
    while status.get('state') == 'working' and time.monotonic() < until:
        time.sleep(1)
        status = sync_request(config, '/backup/' + operation)
    require(status.get('state') == 'ready' and status.get('helperCompletedAt') and
            status.get('configuration', {}).get('status') == 'ready' and status.get('seed', {}).get('status') == 'completed',
            'matching-backup-not-complete-inspect-backup-operation')
    # Read the native retained export after its authenticated workflow completes;
    # validate every association and copied byte before accepting the pair.
    source = config['_main'].parent / '.coordinated-backups' / operation / 'bootstrapper.zip'
    raw = successor._private_bytes(source, 64 * 1024 ** 2)
    require(digest(raw) == status['configuration']['sha256'], 'matching-configuration-backup-hash-mismatch')
    output = Path(plan_value['configurationBackup'])
    require(not output.exists() and output.parent.stat().st_dev == Path(config['SEED_DIR']).stat().st_dev,
            'configuration-backup-destination-changed')
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    with zipfile.ZipFile(output) as archive:
        require(len(archive.namelist()) == len(set(archive.namelist())), 'duplicate-configuration-backup-entries')
        require(all(info.file_size <= 50 * 1024 ** 2 for info in archive.infolist()), 'configuration-backup-entry-too-large')
        association = json.loads(archive.read('recovery.json')).get('seed', {})
        seed = status['seed']
        require(association.get('format') == 'system-backup-pair-v1' and association.get('verified') is True and
                association.get('status') == 'matched-completed-seed' and association.get('operation') == operation and
                all(association.get(key) == seed.get(key) for key in ('generation', 'manifestSha256', 'gitlabImageId')),
                'configuration-Seed-pair-mismatch')
        manifest = Path(config['SEED_DIR']) / 'snapshots' / seed['generation'] / 'manifest.json'
        require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', seed['generation']) and not manifest.is_symlink() and
                digest(manifest.read_bytes()) == seed['manifestSha256'], 'completed-Seed-manifest-mismatch')
        files = association.get('configurationFiles', [])
        expected_files = ['.docker.env'] + ['.projects.env/' + file.name for file in sorted((config['_main'].parent / '.projects.env').glob('*.env'))]
        require(isinstance(files, list) and [row.get('filename') for row in files] == expected_files,
                'configuration-backup-file-set-mismatch')
        for row in files:
            relative = row.get('filename', '')
            require(relative == '.docker.env' or re.fullmatch(r'\.projects.env/\.[A-Za-z0-9_.-]+\.env', relative),
                    'invalid-backup-configuration-path')
            require(digest(archive.read(relative)) == row['sha256'] == digest((config['_main'].parent / relative).read_bytes()),
                    'backup-no-longer-matches-live-configuration')
    require(digest(config['_main'].read_bytes()) == plan_value['configurationSha256'], 'configuration-changed-during-backup')
    successor.atomic_json(target / 'backup.json', {'operation': operation, 'configurationFile': str(output),
        'sha256': digest(raw), 'seed': status['seed']})


@contextmanager
def coordinator(target):
    descriptor = os.open(target / '.coordinator.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise recovery.RecoveryError('this-public-upgrade-coordinator-is-running') from None
        yield
    finally:
        os.close(descriptor)


def apply(args, config):
    target = directory(config, args.plan_dir)
    with coordinator(target):
        return apply_locked(args, config, target)


def apply_locked(args, config, target):
    authority = security = None
    def dispatch(method, arguments):
        nonlocal authority, security
        if method == 'publicInputs':
            raw, proof, authority, security = public_inputs(*arguments, config)
            return {'targetSha256': digest(raw), 'provenanceSha256': digest(proof), 'release': authority.release}
        if method == 'prerequisite': return recovery.host_operation('gitlabUpgradePrerequisite', config['_root'], arguments[0], authority.release['sourceRevision'], security)
        if method == 'installed': return installed(config, *arguments)[1]
        if method == 'fingerprints': return {'selectionSha256': digest(successor.private_input(config['_root'] / 'configuration/.release-images.json')), 'configurationSha256': digest(config['_main'].read_bytes())}
        if method == 'assertBaseline': runtime.assert_baseline(config, arguments[0])
        elif method == 'dataSample': return data_sample()
        elif method == 'host': host(authority.metadata)
        elif method == 'backupTarget': backup_target(config, arguments[0])
        elif method == 'invoke': invoke(config, authority, security, arguments[1], target / 'target.json', args.token_file, args.timeout, arguments[0], *([arguments[2]] if arguments[2] is not None else []))
        elif method == 'archive': return archives.save_archive(target, arguments[1]['reference'], arguments[1]['imageId'], arguments[2])
        elif method == 'matchingBackup': matching_backup(config, target, arguments[0], args.backup_timeout)
        elif method == 'waitReady': return updater.wait_ready(config, arguments[0], args.token_file, None, recovery.budget(args.timeout))
        else: raise recovery.RecoveryError('unknown-public-upgrade-native-port')
    try:
        return host_service.invoke('public-upgrade-apply-entry.js', {'directory': str(target), 'confirmation': args.confirm_plan},
                                   dispatch, recovery.RecoveryError)
    except BaseException:
        recovery.host_operation('interruptUpgrade', target)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operation', choices=['plan', 'apply', 'status', 'recover'], default='plan')
    parser.add_argument('--persistence-env', required=True)
    parser.add_argument('--plan-dir', required=True)
    parser.add_argument('--repository', default='kihyoun/system', help='Trusted public publisher repository, not a signature key.')
    parser.add_argument('--target', help='Explicit product version; no latest or unattended upgrade.')
    parser.add_argument('--backup-file', help='New configuration ZIP on the selected backup filesystem.')
    parser.add_argument('--token-file', help='Private API token for this installation, never the publisher GitLab.')
    parser.add_argument('--gitlab-checkpoint', help='Retained completed native GitLab cold checkpoint required by database-migration transitions.')
    parser.add_argument('--confirm-plan', help='Exact plan SHA-256 required for apply or recover.')
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--backup-timeout', type=int, default=3600)
    args = parser.parse_args()
    require(os.geteuid() == 0 and 60 <= args.timeout <= 3600 and 60 <= args.backup_timeout <= 7200,
            'root-and-bounded-timeouts-required')
    config = runtime.settings(args.persistence_env)
    config['_persistence_env'] = args.persistence_env
    if args.operation == 'plan':
        require(args.target and args.backup_file and args.token_file, 'target-backup-file-and-own-API-token-required')
        value, sha256 = plan(args, config)
        print(json.dumps({**value, 'confirmPlanSha256': sha256}, indent=2))
    elif args.operation == 'apply':
        require(args.token_file, 'own-installation-API-token-required')
        print(json.dumps(apply(args, config), indent=2))
    else:
        target = directory(config, args.plan_dir)
        if not (target / 'plan.json').exists():
            require(args.operation == 'status', 'no-reviewed-plan-recover-native-operation-before-replanning')
            print(json.dumps(json.loads(successor.private_input(target / 'preflight.json')), indent=2))
            return
        value = json.loads(successor.private_input(target / 'plan.json'))
        state_file = target / 'operation.json'
        state = json.loads(successor.private_input(state_file)) if state_file.exists() else {'phase': 'planned'}
        checkpoint = Path(value['checkpoint'])
        if args.operation == 'recover':
            require(args.confirm_plan == digest(successor.private_input(target / 'plan.json')) and args.token_file,
                    'explicit-plan-confirmation-and-own-token-required-for-recovery')
            require((checkpoint / 'operation.json').is_file(), 'no-controller-update-started-inspect-backup-status-and-retained-operation')
            with coordinator(target):
                retained = json.loads(successor.private_input(target / 'previous-images.json'))
                updater.rollback(config, checkpoint, args.token_file, timeout=args.timeout,
                                 retained_images=(target, retained))
                state = recovery.host_operation('upgradePhase', target, 'rolled-back', {
                    'databaseRewound': False, 'recoveryImageSelectors': True,
                    'restoredVersion': value['installedVersion'],
                    'originalConfiguration': str(checkpoint / 'main-before.env')}, state['phase'])
        backup_operation = json.loads(successor.private_input(target / 'backup-operation.json')) if (target / 'backup-operation.json').exists() else None
        if backup_operation:
            backup_operation['status'] = json.loads(successor.private_input(config['_main'].parent / '.coordinated-backups' / backup_operation['id'] / 'status.json'))
        print(json.dumps({'operation': state, 'backupOperation': backup_operation, 'backup': json.loads(successor.private_input(target / 'backup.json'))
            if (target / 'backup.json').exists() else None,
            'controller': updater.load_operation(config, checkpoint)[1]['phase']
            if (checkpoint / 'operation.json').exists() else 'not-started'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Public upgrade refused: ' + (str(error) if isinstance(error, recovery.RecoveryError) else type(error).__name__) +
              '. Inspect --operation status and the public upgrade guide; do not remove active leases.', file=sys.stderr)
        sys.exit(1)
