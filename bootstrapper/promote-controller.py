#!/usr/bin/env python3
"""Promote the exact CI-tested controller, preserving the old GitLab until migration.

Legacy Sync APIs require a real cold maintenance bridge. This command never
changes GITLAB_IMAGE, applies a Seed or automatically rolls an old image back.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
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


SCHEDULING_STOP = ('for service in nginx gitlab-workhorse puma; do '
    'read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); '
    'if [ "$remaining" -le 0 ] || [ "$remaining" -gt 110 ]; then exit 124; fi; '
    'timeout -k 2 "$remaining" gitlab-ctl stop "$service"; '
    'state=$(/opt/gitlab/embedded/bin/sv status "/opt/gitlab/service/$service"); '
    'case "$state" in down:*) ;; *) exit 1 ;; esac; done')
SCHEDULING_START = ('for service in nginx gitlab-workhorse puma; do '
    'read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); '
    'if [ "$remaining" -le 0 ] || [ "$remaining" -gt 150 ]; then exit 124; fi; '
    'timeout -k 2 "$remaining" gitlab-ctl start "$service"; done')
ALL_SERVICES_STOP = ('read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); '
    'if [ "$remaining" -le 0 ] || [ "$remaining" -gt 110 ]; then exit 124; fi; '
    'timeout -k 2 "$remaining" gitlab-ctl stop')
ALL_SERVICES_DOWN = ('found=false; for service in /opt/gitlab/service/*; do '
    '[ -L "$service" ] || continue; found=true; '
    'state=$(/opt/gitlab/embedded/bin/sv status "$service"); '
    'case "$state" in down:*) ;; *) exit 1 ;; esac; done; [ "$found" = true ]')


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

    def remote(self, script, seconds, phase):
        deadline = int(float(Path('/proc/uptime').read_text().split()[0])) + seconds
        self.phase(phase, deadline)
        run([*DOCKER, 'exec', '--env', 'SVWAIT=90', self.gitlab['Id'], '/bin/sh', '-ec',
             script, 'sh', str(deadline)], timeout=seconds + 15)

    def drain(self):
        deadline = time.monotonic() + self.deadline
        consecutive = 0
        while time.monotonic() < deadline:
            current = inspect(self.gitlab['Id'])
            require('ExecIDs' in current, 'Docker-exec-drain-inspection-is-unavailable')
            require(current['Id'] == self.gitlab['Id'] and current['State']['Running'], 'GitLab-changed-during-drain')
            if current['ExecIDs'] in (None, []):
                consecutive += 1
                if consecutive >= 2:
                    return
            else:
                consecutive = 0
            time.sleep(1)
        raise recovery.RecoveryError('remote-GitLab-exec-drain-timeout')

    def resume_unmodified(self):
        current = inspect(self.gitlab['Id'])
        require(current['State']['Running'] and current['Image'] == self.gitlab['Image'],
                'previous-GitLab-generation-is-not-safe-to-resume')
        if self.main_hash:
            require(recovery.sha(self.config['_main']) == self.main_hash, 'configuration-changed-before-maintenance-resume')
        self.remote(SCHEDULING_START, 150, 'old-ingress-resume-started')
        deadline = time.monotonic() + 90
        while True:
            try:
                run([*DOCKER, 'exec', self.gitlab['Id'], 'curl', '-fsS', '--max-time', '5',
                     'http://127.0.0.1/-/readiness'], timeout=10)
                break
            except recovery.RecoveryError:
                if time.monotonic() >= deadline:
                    raise recovery.RecoveryError('previous-GitLab-ingress-not-ready') from None
                time.sleep(2)
        controller = inspect(self.controller['Id'])
        require(controller['Image'] == self.controller['Image'] and controller['State']['Running'],
                'previous-controller-is-not-safe-to-resume')
        policy = self.policy['Name']
        require(policy in ('no', 'always', 'unless-stopped', 'on-failure'), 'invalid-original-restart-policy')
        if policy == 'on-failure' and self.policy.get('MaximumRetryCount'):
            policy += ':' + str(int(self.policy['MaximumRetryCount']))
        run([*DOCKER, 'update', '--restart=' + policy, controller['Id']])
        if controller['State'].get('Paused'):
            run([*DOCKER, 'unpause', controller['Id']])
        if not inspect(self.web['Id'])['State']['Running']:
            run([*DOCKER, 'start', self.web['Id']])
        require(inspect(self.controller['Id'])['State']['Running'] and
                not inspect(self.controller['Id'])['State'].get('Paused') and
                inspect(self.web['Id'])['State']['Running'], 'previous-control-plane-did-not-resume')
        self.phase('old-generation-resumed-without-database-stop')

    def quiesce_ingress(self):
        self.remote(SCHEDULING_STOP, 110, 'scheduling-ingress-stop-started')
        proof = gitlab_probe(self.security, self.gitlab)
        if proof['runningJobs'] != 0:
            self.resume_unmodified()
            raise ActiveJobs('new-running-jobs-refused-maintenance-old-generation-resumed')
        self.phase('scheduling-ingress-stopped-final-jobs-zero')

    def clean_gitlab_stop(self):
        self.remote(ALL_SERVICES_STOP, 110, 'GitLab-services-stop-started')
        run([*DOCKER, 'exec', self.gitlab['Id'], 'timeout', '-k', '1', '20', '/bin/sh', '-ec',
             ALL_SERVICES_DOWN], timeout=25)
        self.drain()
        run([*DOCKER, 'stop', '--time', '60', self.gitlab['Id']], timeout=70)
        state = inspect(self.gitlab['Id'])['State']
        require(not state['Running'] and state['ExitCode'] == 0 and not state.get('OOMKilled'),
                'GitLab-stop-was-not-clean')
        self.phase('GitLab-container-cleanly-stopped')

    def run(self):
        owned(self.web, 'web')
        owned(self.controller, 'bootstrapper')
        require(self.controller['State']['Running'] and not self.controller['State'].get('Paused'),
                'running-unpaused-controller-required')
        run([*DOCKER, 'update', '--restart=no', self.controller['Id']])
        self.phase('public-web-stop-started')
        run([*DOCKER, 'stop', '--time', '30', self.web['Id']])
        require(not inspect(self.web['Id'])['State']['Running'], 'public-web-stop-failed')
        self.phase('old-controller-freeze-started')
        run([*DOCKER, 'pause', self.controller['Id']])
        frozen = inspect(self.controller['Id'])
        require(frozen['State']['Paused'] and frozen['HostConfig']['RestartPolicy']['Name'] == 'no',
                'old-controller-was-not-frozen-with-restart-disabled')
        self.drain()
        # External runners can claim jobs through GitLab directly even when the
        # entry proxy is stopped. Close all scheduling ingress before the final
        # jobs=0 observation, and never kill a job that raced the first check.
        self.quiesce_ingress()
        self.phase('owned-runners-stop-started')
        for runner in self.runners:
            run([*DOCKER, 'stop', '--time', '30', runner['Id']])
            require(not inspect(runner['Id'])['State']['Running'], 'owned-runner-stop-failed')
        self.clean_gitlab_stop()
        run([*DOCKER, 'kill', self.controller['Id']])
        stopped = inspect(self.controller['Id'])
        require(not stopped['State']['Running'] and stopped['State']['ExitCode'] == 137 and
                not stopped['State'].get('OOMKilled') and stopped.get('ExecIDs') in (None, []),
                'old-controller-stop-is-uncertain')
        self.phase('old-controller-killed-before-cold-checkpoint')
        return checkpoint_copy(self.config, self.checkpoint, self.image)


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
    with successor.Lease(config) as lease:
        record['leaseOperation'] = lease.operation
        successor.atomic_json(checkpoint / 'operation.json', record)
        require(config['_main'].read_bytes() == raw, 'configuration-changed-before-controller-promotion')
        if staged_receipt:
            require(recovery.sha(config['_root'] / 'recovery/images.json') == staged_receipt['manifestSha256'],
                    'staged-controller-recovery-manifest-changed')
            require(recovery.sha(Path(staged) / 'operation.json') == staged_receipt['operationSha256'],
                    'staged-controller-operation-changed')
            require(inspect('system_bootstrapper_1')['Id'] == controller['Id'] and
                    inspect('system_gitlab_1')['Image'] == gitlab['Image'], 'staged-controller-services-changed')
            runtime.assert_baseline(config, baseline)
        # Recheck external acceptance immediately before entering maintenance.
        successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
        if cold:
            runners = main_runner_rows(config)
            lease.critical = True
            record['phase'] = 'cold-maintenance-started'
            successor.atomic_json(checkpoint / 'operation.json', record)
            def journal(phase, deadline):
                record['coldPhase'] = phase
                if deadline is not None:
                    record['remoteCommandDeadlineUptime'] = deadline
                    record['remoteCommandBootId'] = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                successor.atomic_json(checkpoint / 'operation.json', record)
            try:
                record['coldCheckpointSha256'] = ColdMaintenance(config, controller, gitlab, web, runners,
                    checkpoint, release['imageId'], security=security, journal=journal).run()
            except ActiveJobs:
                record['phase'] = 'deferred-active-jobs-old-generation-resumed'
                successor.atomic_json(checkpoint / 'operation.json', record)
                lease.critical = False
                raise
        else:
            successor.sync_idle(config)
            lease.critical = True
            record['phase'] = 'controller-stop-started'
            successor.atomic_json(checkpoint / 'operation.json', record)
            run([*DOCKER, 'update', '--restart=no', controller['Id']])
            run([*DOCKER, 'stop', '--time', '30', controller['Id']])
            require(not inspect(controller['Id'])['State']['Running'], 'old-controller-did-not-stop')
        record['phase'] = 'pre-promotion-checkpoint-complete'
        successor.atomic_json(checkpoint / 'operation.json', record)
        require(config['_main'].read_bytes() == raw, 'configuration-changed-during-controller-stop')
        info = config['_main'].stat()
        successor.atomic_bytes(config['_main'], updated, stat.S_IMODE(info.st_mode))
        os.chown(config['_main'], info.st_uid, info.st_gid)
        record['phase'] = 'controller-start-started'
        successor.atomic_json(checkpoint / 'operation.json', record)
        run([*DOCKER, 'compose', '--compatibility', '-p', 'system', '-f',
             str(successor.HERE.parent / 'system/docker-compose.yml'), 'up', '--no-build', '--no-deps',
             '--pull', 'never', '-d', 'bootstrapper'], env=successor.environment(config, alias))
        config = runtime.settings(config['_persistence_env'])
        baseline['configurationFiles']['configuration/.docker.env'] = hashlib.sha256(updated).hexdigest()
        baseline['hostToolsRevision'] = release['sourceRevision']
        wait_for_staged(config, original, baseline, release, gitlab['Image'], timeout)
        gitlab_preflight(security, inspect('system_gitlab_1'))
        record.update(phase='controller-promoted-old-GitLab-preserved', completedAt=runtime.now(),
                      newControllerId=inspect('system_bootstrapper_1')['Id'], oldGitLabImagePreserved=True,
                      configurationChangedOnlyControllerImage=True, managerIdentitiesPreserved=True,
                      GitLabMigrationStarted=False)
        successor.atomic_json(checkpoint / 'operation.json', record)
        return record


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
    require(record.get('format') == 'system-controller-promotion-v1' and
            record.get('phase') not in ('controller-promoted-old-GitLab-preserved', 'aborted', 'deferred-active-jobs-old-generation-resumed') and
            bool(record.get('leaseOperation')), 'only-interrupted-controller-promotion-can-be-aborted')
    successor.verify_checkout(record['release'], successor.HERE.parent)
    before = successor.private_input(checkpoint / 'main-before.env')
    require(hashlib.sha256(before).hexdigest() == record['configurationBeforeSha256'] and
            hashlib.sha256(config['_main'].read_bytes()).hexdigest() in
            (record['configurationBeforeSha256'], record['configurationAfterSha256']),
            'controller-abort-configuration-hash-mismatch')
    runtime.cube(before)
    gitlab = inspect('system_gitlab_1')
    owned(gitlab, 'gitlab')
    require(gitlab['Image'] == record['oldGitLab']['imageId'],
            'controller-abort-refuses-GitLab-image-change-use-database-checkpoint-recovery')
    old = recovery.inspect_image(record['previousController']['imageId'])
    require(old['Id'] == record['previousController']['imageId'], 'previous-controller-image-is-unavailable')
    lease = successor.Lease.adopt(config, record['leaseOperation'])
    try:
        helper_receipt = checkpoint / 'copy-helper.json'
        if helper_receipt.exists():
            helper = json.loads(successor.private_input(helper_receipt))
            try:
                remaining = inspect(helper['name'])
            except recovery.RecoveryError:
                remaining = None
            if remaining:
                require(remaining['Config']['Labels'].get('org.system-bootstrapper.controller-copy') == helper['owner'],
                        'checkpoint-helper-ownership-changed')
                run([*DOCKER, 'rm', '--force', remaining['Id']])
        if record.get('coldCheckpointSha256'):
            verify_cold_checkpoint(checkpoint, record['coldCheckpointSha256'])
        deadline = record.get('remoteCommandDeadlineUptime')
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        if deadline and boot == record.get('remoteCommandBootId'):
            remaining = deadline - float(Path('/proc/uptime').read_text().split()[0])
            require(remaining < 180, 'controller-abort-remote-deadline-invalid')
            if remaining > 0:
                time.sleep(remaining + 2)
        current = inspect('system_bootstrapper_1')
        web = inspect('system_web_1')
        owned(current, 'bootstrapper')
        if web['State']['Running']:
            run([*DOCKER, 'stop', '--time', '30', web['Id']])
        if current['State']['Running']:
            run([*DOCKER, 'update', '--restart=no', current['Id']])
            if not current['State'].get('Paused'):
                run([*DOCKER, 'pause', current['Id']])
        if gitlab['State']['Running']:
            security = json.loads((successor.HERE.parent / 'gitlab/security-release.json').read_bytes())
            maintenance = ColdMaintenance(config, current, gitlab, web, [], checkpoint, old['Id'], security=security)
            maintenance.drain()
            maintenance.quiesce_ingress()
            early = record.get('coldPhase') in ('public-web-stop-started', 'old-controller-freeze-started',
                'scheduling-ingress-stop-started', 'scheduling-ingress-stopped-final-jobs-zero',
                'old-ingress-resume-started', 'old-generation-resumed-without-database-stop')
            if early and config['_main'].read_bytes() == before:
                maintenance.policy = record['previousController']['restartPolicy']
                maintenance.resume_unmodified()
                record.update(phase='aborted', abortedAt=runtime.now(), databaseRewound=False)
                successor.atomic_json(checkpoint / 'operation.json', record)
                lease.release()
                return
            for row in main_runner_rows(config):
                run([*DOCKER, 'stop', '--time', '30', row['Id']])
            maintenance.clean_gitlab_stop()
        else:
            require(gitlab['State']['ExitCode'] == 0 and not gitlab['State'].get('OOMKilled'),
                    'controller-abort-requires-clean-old-GitLab-state')
        if current['State']['Running']:
            run([*DOCKER, 'kill', current['Id']])
            require(not inspect(current['Id'])['State']['Running'], 'controller-abort-stop-uncertain')
        # The native lease proves no coordinated GitLab migration could enter.
        # No database is rewound here: only the previous controller/configuration
        # is resumed on the same old GitLab image. A changed GitLab image refuses.
        successor.atomic_bytes(config['_main'], before)
        run([*DOCKER, 'compose', '--compatibility', '-p', 'system', '-f',
             str(successor.HERE.parent / 'system/docker-compose.yml'), 'up', '--no-build', '--no-deps',
             '--pull', 'never', '-d', 'bootstrapper'],
            env=successor.environment(config, record['previousController']['imageId']))
        config = runtime.settings(config['_persistence_env'])
        deadline = time.monotonic() + timeout
        while True:
            try:
                rows = runtime.inspect_services(config)
                require(rows['system_bootstrapper_1']['Image'] == old['Id'] and
                        rows['system_gitlab_1']['Image'] == record['oldGitLab']['imageId'], 'controller-abort-image-mismatch')
                runtime.verify_mounts(config, rows)
                runtime.verify_routes(config, rows)
                runtime.verify_sync(config)
                require(config['_main'].read_bytes() == before, 'controller-abort-config-changed')
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise recovery.RecoveryError('controller-abort-acceptance-timeout') from None
                time.sleep(3)
        policy = record['previousController']['restartPolicy']['Name']
        require(policy in ('no', 'always', 'unless-stopped', 'on-failure'), 'invalid-original-restart-policy')
        retries = record['previousController']['restartPolicy'].get('MaximumRetryCount', 0)
        if policy == 'on-failure' and retries:
            policy += ':' + str(int(retries))
        run([*DOCKER, 'update', '--restart=' + policy, rows['system_bootstrapper_1']['Id']])
        record.update(phase='aborted', abortedAt=runtime.now(), databaseRewound=False)
        successor.atomic_json(checkpoint / 'operation.json', record)
        lease.release()
    except Exception:
        # Keep the exact lease on any uncertain recovery; the same committed
        # abort action can be retried after the interrupted process has ended.
        raise


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
