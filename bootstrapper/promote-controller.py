#!/usr/bin/env python3
"""Promote the exact CI-tested controller, preserving the old GitLab until migration.

Legacy Sync APIs require a real cold maintenance bridge. This command never
changes GITLAB_IMAGE, applies a Seed or automatically rolls an old image back.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import host_service
import sys
import tempfile
import time

sys.dont_write_bytecode = True
import successor

runtime, recovery = successor.runtime, successor.recovery
require, run, DOCKER = successor.require, successor.run, successor.DOCKER


def inspect(name):
    rows = json.loads(run([*DOCKER, 'inspect', name]))
    require(len(rows) == 1, 'exact-container-inspection-required')
    return rows[0]


def owned(row, service):
    labels = row.get('Config', {}).get('Labels', {})
    require(labels.get('com.docker.compose.project') == 'system' and
            labels.get('com.docker.compose.service') == service, 'owned-core-container-required')


def gitlab_probe(expected, row):
    owned(row, 'gitlab')
    require(row['State']['Running'] and not row['State'].get('OOMKilled'), 'old-GitLab-is-not-running')
    script = (successor.HERE.parent / 'gitlab/upgrade-preflight.rb').read_bytes()
    output = run([*DOCKER, 'exec', '-i', row['Id'], 'gitlab-rails', 'runner', '-'], input=script)
    proof = json.loads(output.decode().splitlines()[-1])
    require(proof.get('version') == expected['fromVersion'] and proof.get('edition') == 'CE' and
            type(proof.get('runningJobs')) is int and proof.get('unfinishedBackgroundMigrations') == 0,
            'old-GitLab-version-jobs-or-migrations-block-promotion')
    return proof


def gitlab_preflight(expected, row):
    proof = gitlab_probe(expected, row)
    require(proof['runningJobs'] == 0, 'old-GitLab-running-jobs-block-promotion')
    return proof


def pull_accepted(api, release):
    registry = release['registryRepository'].split('/')[0]
    username = api.get('/user').get('username')
    require(isinstance(username, str) and bool(username) and '\n' not in username,
            'registry-API-user-required')
    with tempfile.TemporaryDirectory(prefix='system-controller-registry-') as directory:
        os.chmod(directory, 0o700)
        run([*DOCKER, '--config', directory, 'login', '--username', username,
             '--password-stdin', registry], input=(api.token + '\n').encode())
        run([*DOCKER, '--config', directory, 'pull', release['registryReference']])
    image = recovery.inspect_image(release['registryReference'])
    labels = image.get('Config', {}).get('Labels', {})
    require(image['Id'] == release['imageId'] and release['registryReference'] in image.get('RepoDigests', []) and
            labels.get('org.opencontainers.image.revision') == release['sourceRevision'] and
            labels.get('org.system-bootstrapper.test-job') == str(release['candidateJobId']),
            'pulled-image-does-not-match-accepted-source-job')


def inventory(root, excluded=()):
    entries = []
    for parent, directories, files in os.walk(root, followlinks=False):
        directories[:] = sorted(name for name in directories if name not in excluded)
        names = sorted(set(directories + files))
        for name in names:
            path = Path(parent) / name
            info = path.lstat()
            entry = {'path': str(path.relative_to(root)), 'mode': stat.S_IMODE(info.st_mode),
                     'uid': info.st_uid, 'gid': info.st_gid}
            if path.is_symlink():
                entry.update(type='link', target=os.readlink(path))
            elif path.is_dir():
                entry['type'] = 'directory'
            elif path.is_file():
                entry.update(type='file', bytes=info.st_size, sha256=recovery.sha(path))
            else:
                # Runtime sockets/devices are not durable service data.
                continue
            entries.append(entry)
    return sorted(entries, key=lambda entry: entry['path'])


def checkpoint_copy(config, checkpoint, image):
    excluded = ('.gitlab-upgrade-lock', '.wizard.env.environments.lock')
    source_roots = [('gitlab', config['_root'] / 'gitlab'), ('configuration', config['_root'] / 'configuration')]
    size = sum(path.stat().st_size for _, root in source_roots for path in root.rglob('*')
               if path.is_file() and not path.is_symlink())
    require(shutil.disk_usage(checkpoint).free > size * 1.25 + 100 * 1024 ** 2,
            'controller-cold-checkpoint-space-insufficient')
    manifests = {}
    for label, source in source_roots:
        destination = checkpoint / label
        destination.mkdir(mode=0o700)
        before = inventory(source, excluded)
        helper = 'system-controller-copy-' + __import__('uuid').uuid4().hex
        successor.atomic_json(checkpoint / 'copy-helper.json', {'name': helper, 'owner': helper})
        command = [*DOCKER, 'run', '--rm', '--name', helper,
                   '--label', 'org.system-bootstrapper.controller-copy=' + helper, '--network', 'none', '--read-only', '--user', '0',
                   '--memory', '256m', '--cpus', '1', '--pids-limit', '64',
                   '--mount', 'type=bind,src=' + str(source) + ',dst=/source,readonly',
                   '--mount', 'type=bind,src=' + str(destination) + ',dst=/destination',
                   '--entrypoint', 'timeout', image, '-k', '2', '240', 'rsync', '-a', '--numeric-ids', '--no-specials', '--no-devices', '--fsync']
        command += ['--exclude=' + name for name in excluded]
        command += ['/source/', '/destination/']
        try:
            run(command)
        except Exception:
            # A killed Docker client does not stop its remote container. Clean
            # only this exactly named/marked helper before releasing any state.
            try:
                remaining = inspect(helper)
            except recovery.RecoveryError:
                remaining = None
            if remaining:
                require(remaining['Config']['Labels'].get('org.system-bootstrapper.controller-copy') == helper,
                        'checkpoint-helper-ownership-changed')
                run([*DOCKER, 'rm', '--force', remaining['Id']])
            raise
        after, copied = inventory(source, excluded), inventory(destination, excluded)
        require(before == after == copied, 'controller-cold-checkpoint-content-mismatch')
        manifests[label] = copied
        for parent, directories, files in os.walk(destination, topdown=False, followlinks=False):
            successor.directory_barrier(parent)
    successor.directory_barrier(checkpoint)
    successor.directory_barrier(checkpoint.parent)
    successor.directory_barrier(checkpoint.parent.parent)
    successor.atomic_controller_checkpoint(checkpoint / 'cold-checkpoint.json', {'format': 'system-controller-cold-checkpoint-v1',
                                                              'at': runtime.now(), 'entries': manifests})
    digest = recovery.sha(checkpoint / 'cold-checkpoint.json')
    verify_cold_checkpoint(checkpoint, digest)
    return digest


def verify_cold_checkpoint(checkpoint, expected):
    receipt = Path(checkpoint) / 'cold-checkpoint.json'
    raw = successor.controller_checkpoint_input(receipt)
    require(isinstance(expected, str) and len(expected) == 64 and
            hashlib.sha256(raw).hexdigest() == expected, 'controller-cold-checkpoint-hash-mismatch')
    contents = json.loads(raw)
    require(contents.get('format') == 'system-controller-cold-checkpoint-v1' and
            isinstance(contents.get('entries'), dict) and set(contents['entries']) == {'gitlab', 'configuration'},
            'controller-cold-checkpoint-format-invalid')
    for name, entries in contents['entries'].items():
        require((Path(checkpoint) / name).is_dir() and not (Path(checkpoint) / name).is_symlink(),
                'controller-cold-checkpoint-directory-required')
        require(inventory(Path(checkpoint) / name, ('.gitlab-upgrade-lock', '.wizard.env.environments.lock')) == entries,
                'controller-cold-checkpoint-content-mismatch')


def staged_manifest(config, manifest, services, api, security, checkpoint, target):
    """Authorize one completed staging receipt without publishing a recovery image.

    Only this in-memory validation view declares the already accepted controller.
    Its original archive-backed recovery manifest remains untouched until migration.
    """
    checkpoint = Path(checkpoint)
    boundary = config['_root'] / 'recovery/controller-promotions'
    require(checkpoint.is_absolute() and checkpoint.resolve(strict=True) == checkpoint and
            boundary in checkpoint.parents and checkpoint.is_dir(), 'retained-staged-promotion-directory-required')
    operation_bytes = successor.private_input(checkpoint / 'operation.json')
    record = json.loads(operation_bytes)
    release, evidence = successor.verify_completed_promotion(api, record, security)
    require(release['projectId'] == target['projectId'] and
            release['registryRepository'] == target['registryRepository'], 'staged-controller-project-mismatch')
    successor.verify_source_objects(release, successor.HERE.parent)
    successor.verify_ancestry(manifest.get('sourceCommit'), release['sourceRevision'], successor.HERE.parent)
    successor.verify_ancestry(release['sourceRevision'], target['sourceRevision'], successor.HERE.parent)
    before = successor.private_input(checkpoint / 'main-before.env')
    current = config['_main'].read_bytes()
    alias = successor.controller_alias(release)
    require(hashlib.sha256(before).hexdigest() == record.get('configurationBeforeSha256') and
            hashlib.sha256(current).hexdigest() == record.get('configurationAfterSha256') and
            successor.assignment(before, 'BOOTSTRAPPER_IMAGE', alias) == current and
            config['BOOTSTRAPPER_IMAGE'] == alias and record.get('controllerAlias') == alias,
            'staged-controller-configuration-mismatch')
    manifest_bytes = successor.private_input(checkpoint / 'manifest-before.json')
    require(manifest_bytes ==
            (config['_root'] / 'recovery/images.json').read_bytes(), 'staged-controller-recovery-manifest-changed')
    controller, gitlab = services['system_bootstrapper_1'], services['system_gitlab_1']
    owned(controller, 'bootstrapper')
    owned(gitlab, 'gitlab')
    image = recovery.inspect_image(alias)
    labels = image.get('Config', {}).get('Labels', {})
    require(controller['Id'] == record.get('newControllerId') and controller['Image'] == release['imageId'] and
            controller['State']['Running'] and not controller['State'].get('Paused') and
            not controller['State'].get('OOMKilled') and image['Id'] == release['imageId'] and
            release['registryReference'] in image.get('RepoDigests', []) and
            labels.get('org.opencontainers.image.revision') == release['sourceRevision'] and
            labels.get('org.system-bootstrapper.test-job') == str(release['candidateJobId']),
            'staged-controller-running-image-mismatch')
    require(gitlab['Image'] == evidence['evidence']['gitlabUpgrade']['fromImageId'] ==
            record.get('oldGitLab', {}).get('imageId'), 'staged-controller-old-GitLab-image-changed')
    if record['coldMaintenance']:
        verify_cold_checkpoint(checkpoint, record.get('coldCheckpointSha256'))
    view = copy.deepcopy(manifest)
    require(recovery.declared_image(view, alias) is None, 'staged-controller-already-declared-in-recovery')
    view['localImages'].append({'tag': alias, 'imageId': release['imageId']})
    view['currentController'].update(reference=alias, imageId=release['imageId'],
                                     sourceCommit=release['sourceRevision'], sourceTree=release['sourceTree'])
    recovery.validate_selected_images(view, config['_main'])
    return view, {'checkpoint': str(checkpoint), 'operationSha256': hashlib.sha256(operation_bytes).hexdigest(),
                  'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
                  'sourceRevision': release['sourceRevision'], 'candidateJobId': release['candidateJobId']}


def main_runner_rows(config):
    # Inspect only containers selected by the exact retained runner-image ID,
    # then require their Compose ownership and retained config/home binds.
    expected = recovery.inspect_image(config['GITLAB_RUNNER_IMAGE'])['Id']
    ids = run([*DOCKER, 'ps', '-q']).decode().split()
    if not ids:
        return []
    rows = json.loads(run([*DOCKER, 'inspect', *ids]))
    selected = []
    root = config['_root'] / 'runners'
    for row in rows:
        if row['Image'] != expected:
            continue
        labels = row.get('Config', {}).get('Labels', {})
        project, service = labels.get('com.docker.compose.project', ''), labels.get('com.docker.compose.service', '')
        matches = [item for item in row['Mounts'] if item['Destination'] in ('/etc/gitlab-runner', '/home/gitlab-runner')]
        if not any(root in Path(item['Source']).resolve().parents for item in matches):
            continue  # A different installation's runner is not owned here.
        require(project and service.startswith('docker_') and len(matches) == 2 and
                all(item['Type'] == 'bind' and root in Path(item['Source']).resolve().parents for item in matches),
                'retained-runner-ownership-is-uncertain')
        selected.append(row)
    return selected


class ActiveJobs(recovery.RecoveryError):
    pass


class ColdMaintenance:
    def __init__(self, config, controller, gitlab, web, runners, checkpoint, image,
                 deadline=180, security=None, journal=None):
        self.config, self.controller, self.gitlab = config, controller, gitlab
        self.web, self.runners, self.checkpoint, self.image = web, runners, checkpoint, image
        self.deadline, self.security, self.journal = deadline, security, journal
        self.policy = copy.deepcopy(controller['HostConfig']['RestartPolicy'])
        self.main_hash = recovery.sha(config['_main']) if '_main' in config else None

    def phase(self, value, remote_deadline=None):
        if self.journal:
            self.journal(value, remote_deadline)

    def _execute(self, operation):
        # Framed native ports keep existing command/guardian adapters; TypeScript
        # owns all sequencing, observations, deadlines and resume decisions.
        context = {'controller': self.controller, 'gitlab': self.gitlab, 'web': self.web,
                   'runners': self.runners, 'deadline': self.deadline, 'mainHash': self.main_hash}
        def dispatch(method, args):
            if method == 'command':
                return run([*DOCKER, *args[0]], **({'timeout': args[1]} if args[1] is not None else {})).decode()
            elif method == 'inspect': return inspect(args[0])
            elif method == 'phase': self.phase(*args)
            elif method == 'probe': return gitlab_probe(self.security, self.gitlab)
            elif method == 'checkpoint': return checkpoint_copy(self.config, self.checkpoint, self.image)
            elif method == 'now': return time.monotonic()
            elif method == 'sleep': time.sleep(args[0])
            elif method == 'uptime': return float(Path('/proc/uptime').read_text().split()[0])
            elif method == 'mainHash': return recovery.sha(self.config['_main']) if self.main_hash else None
            else: raise recovery.RecoveryError('unknown-cold-maintenance-native-port')
        return host_service.invoke('cold-maintenance-entry.js', {'operation': operation, 'input': context},
                                   dispatch, recovery.RecoveryError, ActiveJobs)

    def drain(self):
        return self._execute('drain')

    def run(self):
        return self._execute('run')


def wait_for_staged(config, original, baseline, release, expected_gitlab_id, timeout):
    deadline = time.monotonic() + timeout
    while True:
        try:
            rows = runtime.inspect_services(config)
            require(rows['system_bootstrapper_1']['Image'] == release['imageId'], 'staged-controller-image-mismatch')
            require(rows['system_gitlab_1']['Image'] == expected_gitlab_id, 'GitLab-image-changed-before-migration')
            runtime.assert_baseline(config, baseline)
            runtime.verify_mounts(config, rows)
            runtime.verify_routes(config, rows)
            runtime.verify_sync(config)
            return rows
        except Exception:
            if time.monotonic() >= deadline:
                raise recovery.RecoveryError('staged-controller-acceptance-timeout') from None
            time.sleep(3)


def preserved_environment(config, reference, security, evidence, services):
    # Resolve the same trusted assignments/explicit process inputs that Compose
    # will receive. Empty selections must never fall through to a new default.
    environment = successor.environment(config, reference, staged=True)
    previous = evidence.get('evidence', {}).get('gitlabUpgrade', {})
    selections = [('GITLAB_IMAGE', previous.get('fromImageId'), 'system_gitlab_1')]
    if security.get('runner'):
        selections.append(('GITLAB_RUNNER_IMAGE', previous.get('fromRunnerImageId'), None))
    for key, expected, name in selections:
        selected = environment.get(key)
        require(isinstance(selected, str) and bool(selected) and recovery.image_id(expected),
                'controller-promotion-image-selection-required')
        image = recovery.inspect_image(selected)
        require(image.get('Id') == expected, 'controller-promotion-image-selection-changed')
        if '@sha256:' in selected:
            require(recovery.canonical_digest(selected) in image.get('RepoDigests', []),
                    'controller-promotion-image-digest-unverified')
        actual = [services.get(name)] if name else [row for service, row in services.items()
                                                   if service.startswith('runner_docker_')]
        require(all(row and row.get('Image') == expected for row in actual),
                'controller-promotion-running-image-mismatch')
    return environment


def promote(config, release, evidence, api, release_bytes, evidence_bytes, security, checkpoint,
            cold=False, timeout=1200, staged=None):
    require(api.base == runtime.origin(config, 'GITLAB'), 'GitLab-origin-does-not-match-saved-config')
    successor.verify_checkout(release, successor.HERE.parent)
    pipeline = successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
    original = runtime.inspect_services(config)
    runtime.verify_mounts(config, original)
    manifest = recovery.load_manifest(config['_root'] / 'recovery', successor.HERE.parent)
    staged_receipt = None
    if staged:
        manifest, staged_receipt = staged_manifest(config, manifest, original, api, security, staged, release)
    runtime.verify_images(config, manifest, original)
    controller, gitlab, web = (original[name] for name in ('system_bootstrapper_1', 'system_gitlab_1', 'system_web_1'))
    owned(controller, 'bootstrapper')
    require(gitlab['Image'] == evidence['evidence']['gitlabUpgrade']['fromImageId'], 'old-GitLab-image-mismatch')
    gitlab_preflight(security, gitlab)
    baseline = runtime.capture(config, successor.HERE.parent, manifest=manifest)
    raw = config['_main'].read_bytes()
    alias = successor.controller_alias(release)
    promotion_environment = preserved_environment(config, alias, security, evidence, original)
    updated = successor.assignment(raw, 'BOOTSTRAPPER_IMAGE', alias)
    if not cold:
        successor.sync_idle(config)  # Old APIs fail before any host mutation.
    pull_accepted(api, release)
    try:
        existing = recovery.inspect_image(alias)
    except recovery.RecoveryError:
        existing = None
    require(existing is None or existing['Id'] == release['imageId'], 'accepted-controller-alias-would-be-overwritten')
    run([*DOCKER, 'tag', release['registryReference'], alias])
    require(recovery.inspect_image(alias)['Id'] == release['imageId'], 'accepted-controller-alias-mismatch')
    checkpoint = Path(checkpoint)
    root = config['_root'] / 'recovery/controller-promotions'
    require(checkpoint.is_absolute() and root in checkpoint.resolve().parents and not checkpoint.exists(),
            'new-retained-controller-checkpoint-directory-required')
    checkpoint.mkdir(parents=True, mode=0o700)
    checkpoint.chmod(0o700)
    successor.atomic_bytes(checkpoint / 'main-before.env', raw)
    successor.atomic_bytes(checkpoint / 'manifest-before.json', (config['_root'] / 'recovery/images.json').read_bytes())
    record = {'format': 'system-controller-promotion-v1', 'at': runtime.now(), 'phase': 'inputs-verified',
              'release': release, 'pipeline': pipeline, 'coldMaintenance': cold, 'controllerAlias': alias,
              'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
              'configurationAfterSha256': hashlib.sha256(updated).hexdigest(),
              'previousController': {'id': controller['Id'], 'imageId': controller['Image'],
                                     'restartPolicy': controller['HostConfig']['RestartPolicy']},
              'oldGitLab': {'id': gitlab['Id'], 'imageId': gitlab['Image'], 'startedAt': gitlab['State']['StartedAt']}}
    if staged_receipt:
        record['previousStagedPromotion'] = staged_receipt
    successor.atomic_json(checkpoint / 'operation.json', record)
    with successor.Lease(config, legacy_controller=controller) as lease:
        def dispatch(method, args):
            nonlocal config
            if method == 'main': return base64.b64encode(config['_main'].read_bytes()).decode()
            if method == 'sha': return recovery.sha(config['_root'] / 'recovery/images.json' if args[0] == 'manifest' else Path(staged) / 'operation.json')
            if method == 'inspect': return inspect(args[0])
            if method == 'assertBaseline': runtime.assert_baseline(config, args[0])
            elif method == 'pipeline': successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
            elif method == 'critical': lease.critical = args[0]
            elif method == 'journal': successor.atomic_json(checkpoint / 'operation.json', args[0])
            elif method == 'readJournal': return json.loads(successor.private_input(checkpoint / 'operation.json'))
            elif method == 'runners': return main_runner_rows(config)
            elif method == 'cold':
                cold_record, runners = args
                def journal(phase, deadline):
                    cold_record['coldPhase'] = phase
                    if deadline is not None:
                        cold_record['remoteCommandDeadlineUptime'] = deadline
                        cold_record['remoteCommandBootId'] = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                    successor.atomic_json(checkpoint / 'operation.json', cold_record)
                return ColdMaintenance(config, controller, gitlab, web, runners, checkpoint,
                                       release['imageId'], security=security, journal=journal).run()
            elif method == 'syncIdle': successor.sync_idle(config)
            elif method == 'command': run([*DOCKER, *args[0]], **({'env': promotion_environment} if args[1] else {}))
            elif method == 'writeConfiguration':
                info = config['_main'].stat()
                successor.atomic_bytes(config['_main'], base64.b64decode(args[0], validate=True), stat.S_IMODE(info.st_mode))
                os.chown(config['_main'], info.st_uid, info.st_gid)
            elif method == 'reload': config = runtime.settings(config['_persistence_env'])
            elif method == 'waitStaged': wait_for_staged(config, original, args[0], release, gitlab['Image'], timeout)
            elif method == 'gitlabPreflight': gitlab_preflight(security, inspect('system_gitlab_1'))
            elif method == 'now': return runtime.now()
            else: raise recovery.RecoveryError('unknown-promotion-native-port')
        context = {'record': record, 'controller': controller, 'gitlab': gitlab, 'baseline': baseline,
                   'release': release, 'rawMain': base64.b64encode(raw).decode(),
                   'updatedMain': base64.b64encode(updated).decode(), 'cold': cold,
                   'stagedReceipt': staged_receipt, 'checkout': str(successor.HERE.parent),
                   'timeout': timeout, 'leaseOperation': lease.operation}
        return host_service.invoke('promotion-sequence-entry.js', {'input': context}, dispatch,
                                   recovery.RecoveryError, ActiveJobs)


def controller_status(config, checkpoint):
    value = json.loads(successor.private_input(Path(checkpoint) / 'operation.json'))
    require(value.get('format') == 'system-controller-promotion-v1', 'invalid-controller-operation-record')
    return {'format': value['format'], 'phase': value['phase'], 'coldMaintenance': value['coldMaintenance'],
            'leaseOperation': value.get('leaseOperation'), 'GitLabMigrationStarted': value.get('GitLabMigrationStarted', False),
            'previousControllerImageId': value['previousController']['imageId'],
            'oldGitLabImageId': value['oldGitLab']['imageId']}


def abort_promotion(config, checkpoint, timeout=1200):
    checkpoint = Path(checkpoint)
    record = json.loads(successor.private_input(checkpoint / 'operation.json'))
    before = successor.private_input(checkpoint / 'main-before.env')
    lease = None
    def dispatch(method, args):
        nonlocal config, lease
        if method == 'main': return base64.b64encode(config['_main'].read_bytes()).decode()
        if method == 'checkout':
            successor.verify_checkout(args[0], successor.HERE.parent)
            return None
        if method == 'image': return recovery.inspect_image(args[0])
        if method == 'adopt': lease = successor.Lease.adopt(config, args[0])
        elif method == 'helper':
            filename = checkpoint / 'copy-helper.json'
            return json.loads(successor.private_input(filename)) if filename.exists() else None
        elif method == 'inspectOptional':
            try: return inspect(args[0])
            except recovery.RecoveryError: return None
        elif method == 'inspect': return inspect(args[0])
        elif method == 'command': return run([*DOCKER, *args[0]], **({'timeout': args[1]} if args[1] is not None else {})).decode()
        elif method == 'verifyCheckpoint': verify_cold_checkpoint(checkpoint, args[0])
        elif method == 'bootId': return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        elif method == 'uptime': return float(Path('/proc/uptime').read_text().split()[0])
        elif method == 'now': return time.monotonic()
        elif method == 'sleep': time.sleep(args[0])
        elif method == 'mainHash': return recovery.sha(config['_main'])
        elif method == 'runners': return main_runner_rows(config)
        elif method == 'phase': pass
        elif method == 'probe':
            security = json.loads((successor.HERE.parent / 'gitlab/security-release.json').read_bytes())
            return gitlab_probe(security, inspect('system_gitlab_1'))
        elif method == 'writeConfiguration': successor.atomic_bytes(config['_main'], base64.b64decode(args[0], validate=True))
        elif method == 'compose': run([*DOCKER, *args[0]], env=successor.environment(config, args[1]))
        elif method == 'reload': config = runtime.settings(config['_persistence_env'])
        elif method == 'services': return runtime.inspect_services(config)
        elif method == 'mounts': runtime.verify_mounts(config, args[0])
        elif method == 'routes': runtime.verify_routes(config, args[0])
        elif method == 'sync': runtime.verify_sync(config)
        elif method == 'journal': successor.atomic_json(checkpoint / 'operation.json', args[0])
        elif method == 'timestamp': return runtime.now()
        elif method == 'release': lease.release()
        else: raise recovery.RecoveryError('unknown-promotion-abort-native-port')
    return host_service.invoke('promotion-abort-entry.js', {'input': {
        'record': record, 'before': base64.b64encode(before).decode(),
        'checkout': str(successor.HERE.parent), 'timeout': timeout}}, dispatch, recovery.RecoveryError)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operation', choices=['promote', 'status', 'abort'], default='promote')
    parser.add_argument('--persistence-env', required=True)
    parser.add_argument('--release')
    parser.add_argument('--evidence')
    parser.add_argument('--gitlab-url')
    parser.add_argument('--token-file')
    parser.add_argument('--checkpoint-dir', required=True)
    parser.add_argument('--cold-maintenance', action='store_true',
                        help='Required legacy bridge: actual web/controller freeze, remote drain and cold GitLab checkpoint.')
    parser.add_argument('--staged-promotion', help='Completed prior controller checkpoint; authenticate its accepted image while GitLab is still old.')
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--check-only', action='store_true', help='Verify source, CI and local inputs without changing services.')
    args = parser.parse_args()
    require(os.geteuid() == 0 and 60 <= args.timeout <= 3600, 'root-and-bounded-readiness-timeout-required')
    require(not args.staged_promotion or args.operation == 'promote', 'staged-promotion-is-only-for-promotion')
    config = runtime.settings(args.persistence_env)
    config['_persistence_env'] = args.persistence_env
    if args.operation == 'status':
        print(json.dumps(controller_status(config, args.checkpoint_dir), indent=2))
        return
    if args.operation == 'abort':
        abort_promotion(config, args.checkpoint_dir, args.timeout)
        print('Interrupted controller promotion aborted; old controller/configuration resumed without rewinding GitLab data.')
        return
    require(all((args.release, args.evidence, args.gitlab_url, args.token_file)), 'successor-release-API-inputs-required')
    require(args.gitlab_url.rstrip('/') == runtime.origin(config, 'GITLAB'), 'GitLab-origin-does-not-match-saved-config')
    release_bytes, evidence_bytes = successor.private_input(args.release), successor.private_input(args.evidence)
    security = json.loads((successor.HERE.parent / 'gitlab/security-release.json').read_bytes())
    release, evidence = successor.release_inputs(release_bytes, evidence_bytes, security)
    api = successor.GitLab(args.gitlab_url, args.token_file)
    if args.check_only:
        successor.verify_checkout(release, successor.HERE.parent)
        successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
        if args.staged_promotion:
            rows = runtime.inspect_services(config)
            runtime.verify_mounts(config, rows)
            manifest = recovery.load_manifest(config['_root'] / 'recovery', successor.HERE.parent)
            manifest, _ = staged_manifest(config, manifest, rows, api, security, args.staged_promotion, release)
            runtime.verify_images(config, manifest, rows)
        print('Successor source and required GitLab pipeline evidence verified; no services changed.')
        return
    promote(config, release, evidence, api, release_bytes, evidence_bytes, security,
            args.checkpoint_dir, args.cold_maintenance, args.timeout, args.staged_promotion)
    print('Accepted controller promoted; old GitLab preserved. Run the reviewed GitLab migration separately.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Controller promotion stopped: ' + (str(error) if isinstance(error, recovery.RecoveryError)
                                                  else type(error).__name__) +
              '. Inspect the private checkpoint/owned leases; do not resume uncertain old code or roll an old image onto migrated data.',
              file=sys.stderr)
        raise SystemExit(1)
