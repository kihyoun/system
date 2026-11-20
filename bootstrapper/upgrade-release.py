#!/usr/bin/env python3
"""Plan, explicitly apply, inspect or recover a supported official public release.

Uses only public release inputs and this installation's own API credentials.
Quickstart is for a fresh host; source pulls alone never upgrade an installation.
"""
import argparse
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
                [('sourceCommit', 'revision'), ('sourceTree', 'tree'), ('wizardSourceRevision', 'wizardRevision')]),
            'installed-source-does-not-match-official-release')
    successor.verify_source_objects({'sourceRevision': metadata['source']['revision'],
        'sourceTree': metadata['source']['tree'], 'wizardRevision': metadata['source']['wizardRevision']}, ROOT)
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
                    'revision' if role == 'controller' else 'wizardRevision'] and
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
    raw, proof, authority, security = public_inputs(args.repository, args.target, config)
    require(args.target == (ROOT / 'VERSION').read_text().strip(), 'run-the-selected-target-release-checkout')
    successor.verify_checkout(authority.release, ROOT)
    selection, previous = installed(config, args.repository, args.target)
    route = upgrade_paths.path(authority.graph, previous['version'], args.target)
    require(route['status'] == 'supported', 'upgrade-selection-' + route['status'] + '-see-public-upgrade-guide')
    if len(route['transitions']) == 1:
        tested = authority.evidence['evidence']['publicUpgrade']
        require(tested['fromVersion'] == previous['version'] and tested['fromSourceRevision'] == previous['source']['revision'] and
                tested['fromControllerImageId'] == previous['images']['controller']['imageId'] and
                tested['fromWizardImageId'] == previous['images']['wizard']['imageId'], 'installed-release-not-the-tested-upgrade-baseline')
    prerequisite = None
    if any(edge.get('databaseMigration') for edge in route['transitions']):
        require(len(route['transitions']) == 1 and getattr(args, 'gitlab_checkpoint', None),
                'complete-native-gitlab-upgrade-first-and-select-retained-checkpoint')
        prerequisite = recovery.host_operation('gitlabUpgradePrerequisite', config['_root'],
            args.gitlab_checkpoint, authority.release['sourceRevision'], security)
    host(authority.metadata)
    successor.sync_idle(config)
    required = max(edge['minimumFreeGiB'] for edge in route['transitions']) * 1024 ** 3
    docker_root = run([*successor.DOCKER, 'info', '--format', '{{.DockerRootDir}}']).decode().strip()
    for path in (config['_root'], Path(docker_root)):
        require(shutil.disk_usage(path).free >= required, 'insufficient-upgrade-checkpoint-or-image-storage')
    backup = backup_target(config, args.backup_file)
    existing = Path(args.plan_dir).exists()
    target = directory(config, args.plan_dir, new=not existing)
    if existing:
        attempt = json.loads(successor.private_input(target / 'preflight.json'))
        require(attempt.get('format') == 'system-public-upgrade-preflight-v1' and attempt.get('phase') == 'failed' and
                {file.name for file in target.iterdir()} <= {'preflight.json', 'target.json', 'provenance.json', 'previous-release.json', 'previous-selection.json', 'previous-selection.env', 'baseline.json'},
                'existing-upgrade-directory-needs-status-inspection')
    # Existing updater check-only verifies exact image labels, routes, Fetch,
    # running jobs/migrations, manager identities and operator GitLab access.
    checkpoint = config['_root'] / 'recovery/controller-updates' / target.name
    require(not checkpoint.exists(), 'controller-update-checkpoint-already-exists')
    target.mkdir(parents=True, mode=0o700, exist_ok=existing)
    attempt = {'format': 'system-public-upgrade-preflight-v1', 'phase': 'checking', 'targetVersion': args.target, 'at': runtime.now()}
    successor.atomic_json(target / 'preflight.json', attempt)
    try:
        successor.atomic_bytes(target / 'target.json', raw)
        successor.atomic_bytes(target / 'provenance.json', proof)
        successor.atomic_json(target / 'previous-release.json', previous)
        successor.atomic_bytes(target / 'previous-selection.json', successor.private_input(config['_main'].parent / '.release-images.json'))
        successor.atomic_bytes(target / 'previous-selection.env', successor.private_input(config['_main'].parent / '.release-images.env'))
        successor.atomic_json(target / 'baseline.json', runtime.capture(config, ROOT, public=True))
        if len(route['transitions']) == 1:
            invoke(config, authority, security, checkpoint, target / 'target.json', args.token_file, args.timeout, True)
        value = {'format': 'system-public-upgrade-plan-v1', 'installedVersion': previous['version'],
            'targetVersion': args.target, 'repository': args.repository, 'transitions': route['transitions'],
            'gitlabPrerequisite': prerequisite,
            'requiredIntermediateReleases': [row['to'] for row in route['transitions'][:-1]],
            'targetSha256': digest(raw), 'provenanceSha256': digest(proof),
            'selectionSha256': digest(successor.private_input(config['_root'] / 'configuration/.release-images.json')),
            'configurationSha256': digest(config['_main'].read_bytes()),
            'dataSample': data_sample(),
            'baselineSha256': digest(successor.private_input(target / 'baseline.json')),
            'checkpoint': str(checkpoint), 'backupDestination': config['SEED_DIR'], 'configurationBackup': str(backup),
            'minimumFreeGiB': required // 1024 ** 3,
            'affectedServices': ['controller', 'Sync', 'Wizard', 'GitLab', 'core proxies', 'runner managers'],
            'interruption': 'Cold matching backup pauses GitLab; controller/Sync and Wizard restart. Core containers, including GitLab, proxies and runner managers, may be recreated when target Compose policies change. This paired phase preserves the already-migrated service/database selections. Any declared GitLab prerequisite must be completed first with its separate cold checkpoint. Wait for running CI jobs first.',
            'recovery': 'Use this command with --operation recover and the same --plan-dir. Paired recovery does not rewind GitLab. For a database-migration transition, use the separate native GitLab cold-checkpoint rollback only after restoring the paired release; never start the old database image on migrated data.'}
        successor.atomic_json(target / 'plan.json', value)
        attempt['phase'] = 'passed'
        successor.atomic_json(target / 'preflight.json', attempt)
        return value, digest(successor.private_input(target / 'plan.json'))
    except BaseException:
        attempt['phase'] = 'failed'
        successor.atomic_json(target / 'preflight.json', attempt)
        raise


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
    raw_plan = successor.private_input(target / 'plan.json')
    require(args.confirm_plan == digest(raw_plan), 'explicit-matching-plan-SHA256-confirmation-required')
    value = json.loads(raw_plan)
    require(value.get('format') == 'system-public-upgrade-plan-v1', 'invalid-public-upgrade-plan')
    require(len(value['transitions']) == 1, 'apply-required-intermediate-release-first-see-plan')
    require(not (target / 'operation.json').exists(), 'upgrade-already-started-use-status-or-recover')
    raw, proof, authority, security = public_inputs(value['repository'], value['targetVersion'], config)
    require(digest(raw) == value['targetSha256'] and digest(proof) == value['provenanceSha256'], 'public-release-changed-after-plan')
    if value.get('gitlabPrerequisite'):
        current = recovery.host_operation('gitlabUpgradePrerequisite', config['_root'],
            value['gitlabPrerequisite']['checkpoint'], authority.release['sourceRevision'], security)
        require(current == value['gitlabPrerequisite'], 'gitlab-prerequisite-changed-after-plan')
    selection, previous = installed(config, value['repository'], value['targetVersion'])
    require(previous['version'] == value['installedVersion'] and
            digest(successor.private_input(config['_root'] / 'configuration/.release-images.json')) == value['selectionSha256'] and
            digest(config['_main'].read_bytes()) == value['configurationSha256'] and
            digest(successor.private_input(target / 'baseline.json')) == value['baselineSha256'], 'installation-changed-after-plan')
    baseline = json.loads(successor.private_input(target / 'baseline.json'))
    runtime.assert_baseline(config, baseline)
    require(data_sample() == value['dataSample'], 'service-data-sample-changed-after-plan')
    host(authority.metadata)
    backup_target(config, value['configurationBackup'])
    invoke(config, authority, security, value['checkpoint'], target / 'target.json', args.token_file, args.timeout, True)
    state = {'format': 'system-public-upgrade-operation-v1', 'phase': 'retaining-previous-images', 'startedAt': runtime.now()}
    successor.atomic_json(target / 'operation.json', state)
    try:
        # Independent recovery payloads are durable before the cold matching
        # backup takes GitLab offline. Reuse the native recovery exporter.
        (target / 'images').mkdir(mode=0o700)
        retained = {}
        source = tuple(previous['source'][key] for key in ('revision', 'tree', 'wizardRevision'))
        for role in ('controller', 'wizard'):
            image = previous['images'][role]
            retained[role] = archives.save_archive(target, image['reference'], image['imageId'], source)
        successor.atomic_json(target / 'previous-images.json', retained)
        state['phase'] = 'backup-starting'
        successor.atomic_json(target / 'operation.json', state)
        matching_backup(config, target, value, args.backup_timeout)
        state['phase'] = 'backup-services-resuming'
        successor.atomic_json(target / 'operation.json', state)
        runtime.assert_baseline(config, baseline)
        # Harvest restarts GitLab before releasing its leases, but Docker health
        # and application readiness can still be catching up. Use the native
        # verifier before Rails sampling or the updater's strict preflight.
        receipt = updater.wait_ready(config, baseline, args.token_file, None, recovery.budget(args.timeout))
        successor.atomic_json(target / 'post-backup-verification.json', receipt)
        require(data_sample() == value['dataSample'], 'service-data-sample-changed-during-backup')
        state['phase'] = 'paired-update-starting'
        successor.atomic_json(target / 'operation.json', state)
        invoke(config, authority, security, value['checkpoint'], target / 'target.json', args.token_file, args.timeout, False, baseline)
        require(data_sample() == value['dataSample'], 'service-data-sample-changed-after-update-inspect-before-acceptance')
        state.update(phase='completed', completedAt=runtime.now(), version=value['targetVersion'],
            sourceRevision=authority.release['sourceRevision'], databaseMigration=False,
            dataSampleVerified=True, configurationPreserved=True, runnerRegistryOperationalChecks=True)
        successor.atomic_json(target / 'operation.json', state)
    except BaseException:
        state['phase'] = 'needs-inspection'
        successor.atomic_json(target / 'operation.json', state)
        raise
    return state


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
                state.update(phase='rolled-back', databaseRewound=False, recoveryImageSelectors=True,
                    restoredVersion=value['installedVersion'], originalConfiguration=str(checkpoint / 'main-before.env'), completedAt=runtime.now())
                successor.atomic_json(state_file, state)
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
