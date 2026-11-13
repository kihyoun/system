#!/usr/bin/env python3
"""Update a public controller while preserving already-current service images/data.

This explicit path requires no archive recovery manifest and refuses an existing
one. Opt in to the accepted public Wizard with --wizard. Neither mode migrates
GitLab or restores a Seed.
"""
import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import time

sys.dont_write_bytecode = True
import successor

runtime, recovery = successor.runtime, successor.recovery
require, run, DOCKER = successor.require, successor.run, successor.DOCKER
ROOT = successor.HERE.parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, successor.HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


installer = module('public_release_installer', 'install-release.py')
promoter = module('existing_controller_promoter', 'promote-controller.py')


def assignment(raw, reference, selected_key='BOOTSTRAPPER_IMAGE'):
    require(selected_key in ('BOOTSTRAPPER_IMAGE', 'WIZARD_IMAGE'), 'unsupported-update-image-assignment')
    reference = installer.reference(reference)
    runtime.cube(raw)
    # Parse complete literal assignment records, including multiline unrelated
    # values. A BOOTSTRAPPER_IMAGE-looking line inside a quoted secret is data.
    matches, record, start, offset, quote = [], b'', 0, 0, None
    for line in raw.splitlines(keepends=True):
        end = offset + len(line)
        if not record and (not line.strip() or line.lstrip().startswith(b'#')):
            offset = end
            continue
        if not record:
            start = offset
        record += line
        escaped = False
        content = line.removesuffix(b'\n')
        for index, char in enumerate(content):
            if escaped:
                escaped = False
            elif quote == 39:
                if char == 39:
                    quote = None
            elif char == 92:
                escaped = True
            elif char == quote:
                quote = None
            elif quote is None and char in (34, 39):
                quote = char
            elif quote is None and char == 35 and (index == 0 or content[index - 1] in b' \t'):
                break
        offset = end
        if quote is not None or escaped:
            continue
        try:
            tokens = shlex.split(record.decode('utf-8'), comments=True, posix=True)
        except (ValueError, UnicodeDecodeError):
            raise recovery.RecoveryError('unsupported-controller-update-configuration') from None
        if tokens and tokens[0] == 'export':
            tokens = tokens[1:]
        require(len(tokens) == 1 and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=[\s\S]*', tokens[0]),
                'unsupported-controller-update-configuration')
        key, value = tokens[0].split('=', 1)
        if key == selected_key:
            require(recovery.reference(value), 'invalid-existing-image-assignment')
            if selected_key == 'BOOTSTRAPPER_IMAGE':
                installer.reference(value)
            matches.append((start, end))
        record = b''
    require(not record, 'incomplete-controller-update-configuration')
    require(len(matches) <= 1 and all(start >= 1184 for start, _ in matches),
            'duplicate-or-header-controller-assignment')
    line = b"export " + selected_key.encode() + b"='" + reference.encode() + b"'"
    if matches:
        start, end = matches[0]
        result = raw[:start] + line + (b'\n' if raw[start:end].endswith(b'\n') else b'') + raw[end:]
    else:
        result = raw + (b'' if raw.endswith(b'\n') else b'\n') + line + b'\n'
    runtime.cube(result)
    return result


def checkpoint_path(config, path, new=False):
    path = Path(path)
    boundary = config['_root'] / 'recovery/controller-updates'
    require(path.is_absolute() and path == path.resolve() and boundary in path.parents and
            (not path.exists() if new else path.is_dir()), 'retained-controller-update-directory-required')
    require(not path.is_symlink(), 'controller-update-directory-must-not-be-symlink')
    return path


def unchanged_services(services, baseline, controller_optional=False, wizard_optional=False):
    expected = baseline['selectedImages']
    required = set(expected) - ({'system_bootstrapper_1'} if controller_optional else set())
    if wizard_optional:
        required.discard('system_wizard_1')
    require(required <= set(services) <= set(expected), 'controller-update-service-set-changed')
    for name, selected in expected.items():
        if name != 'system_bootstrapper_1' and not (wizard_optional and name == 'system_wizard_1'):
            require(services[name]['Image'] == selected['imageId'], 'controller-update-service-image-changed')


def rollback_services(config, baseline, record):
    # A failed Compose recreate can remove the old controller before creation
    # fails. Prove absence through a successful exact-name list; an inspection
    # transport/permission failure must never be treated as an absent object.
    names = run([*DOCKER, 'container', 'ls', '--all', '--filter',
                 'name=^/system_bootstrapper_1$', '--format', '{{.Names}}']).decode().splitlines()
    require(names in ([], ['system_bootstrapper_1']), 'controller-rollback-ambiguous-controller')
    present = {'system_bootstrapper_1': bool(names)}
    if record.get('wizard'):
        names = run([*DOCKER, 'container', 'ls', '--all', '--filter',
                     'name=^/system_wizard_1$', '--format', '{{.Names}}']).decode().splitlines()
        require(names in ([], ['system_wizard_1']), 'paired-rollback-ambiguous-Wizard')
        present['system_wizard_1'] = bool(names)
    services = {name: promoter.inspect(name) for name in baseline['selectedImages'] if present.get(name, True)}
    unchanged_services(services, baseline, controller_optional=True, wizard_optional=bool(record.get('wizard')))
    runtime.verify_mounts(config, services)
    if present['system_bootstrapper_1']:
        current = services['system_bootstrapper_1']
        promoter.owned(current, 'bootstrapper')
        require(current['Image'] in (record['previousController']['imageId'], record['controller']['imageId']),
                'controller-rollback-refuses-unrelated-controller')
    if record.get('wizard') and present['system_wizard_1']:
        current = services['system_wizard_1']
        promoter.owned(current, 'wizard')
        require(current['Image'] in (record['previousWizard']['imageId'], record['wizard']['imageId']),
                'paired-rollback-refuses-unrelated-Wizard')
    return services


def current_services(config, release, evidence, security, stopped_controller_id=None):
    services = (runtime.inspect_services(config) if stopped_controller_id is None else
                runtime.inspect_services(config, stopped_controller_id=stopped_controller_id))
    runtime.verify_mounts(config, services)
    runtime.public_images(config, services)
    controller = services['system_bootstrapper_1']
    promoter.owned(controller, 'bootstrapper')
    installer.reference(config['BOOTSTRAPPER_IMAGE'])
    upgrade = evidence['evidence']['gitlabUpgrade']
    require(services['system_gitlab_1']['Image'] == upgrade['toImageId'],
            'controller-update-requires-current-GitLab-image')
    for name, row in services.items():
        if name.startswith('runner_docker_'):
            require(row['Image'] == upgrade.get('runnerImageId'), 'controller-update-requires-current-runner-image')
    promoter.gitlab_preflight(dict(security, fromVersion=security['toVersion']), services['system_gitlab_1'])
    if stopped_controller_id is not None:
        stopped_services(services, stopped_controller_id)
    return services


def stopped_services(services, controller_id):
    runtime.failed_stopped_controller(services['system_bootstrapper_1'], controller_id)
    promoter.owned(services['system_bootstrapper_1'], 'bootstrapper')
    repair_peer_services(services)


def repair_peer_services(services):
    for name, row in services.items():
        if name == 'system_bootstrapper_1':
            continue
        labels = row.get('Config', {}).get('Labels', {})
        if name.startswith('runner_docker_'):
            require(labels.get('com.docker.compose.project') == 'runner' and
                    labels.get('com.docker.compose.service') == name.removeprefix('runner_'),
                    'owned-runner-container-required')
        else:
            promoter.owned(row, name.split('_')[1])
        state = row['State']
        require(state.get('Running') is True and not any(state.get(key) for key in
                ('Paused', 'Restarting', 'Dead', 'OOMKilled')), 'repair-peer-service-not-running')
        require(not state.get('Health') or state['Health'].get('Status') == 'healthy', 'repair-peer-service-not-healthy')
        # A controller-launched Rails/provisioning exec can outlive its caller.
        require('ExecIDs' in row and row['ExecIDs'] in (None, []), 'repair-peer-active-or-unknown-execs')


def verify_runner_containers(services, expected):
    actual = {name: row['Id'] for name, row in services.items() if name.startswith('runner_docker_')}
    require(actual == expected, 'repair-runner-containers-changed')


def stopped_operations_idle(config, lease=None):
    """Absence of writers replaces Sync's idle API only for a proven stopped PID."""
    root = config['_root']
    locks = [root / 'configuration/.gitlab-upgrade-lock', root / 'configuration/.storage-operation-lock',
             root / 'host/letsencrypt/.system-bootstrapper-certificate-lock',
             root / 'configuration/.projects.env/.wizard.env.environments.lock']
    if config.get('SEED_DIR'):
        locks.append(Path(config['SEED_DIR']) / '.operation-lock')
    for path in locks:
        if lease is not None and path in lease.held:
            require(path.is_dir() and not path.is_symlink(), 'repair-operation-lease-changed')
            owner = json.loads(successor.private_input(path / 'controller-owner.json'))
            require(owner.get('operation') == lease.operation and owner.get('pid') == os.getpid() and
                    owner.get('processStart') == successor.process_start(os.getpid()), 'repair-operation-lease-changed')
            allowed = {'controller-owner.json'}
            journal = path / 'host-child.json'
            if journal.exists() or journal.is_symlink():
                child = json.loads(successor.private_input(journal))
                require(child.get('operation') == lease.operation and child.get('phase') == 'completed' and
                        not successor.group_live(child.get('childPgid')), 'repair-host-child-is-still-running')
                allowed.add('host-child.json')
            require({entry.name for entry in path.iterdir()} <= allowed, 'repair-operation-lease-changed')
        else:
            require(not path.exists() and not path.is_symlink(), 'unfinished-operation-blocks-stopped-repair')
    for relative in ('gitlab/data/.system-bootstrapper-restore-incomplete',
                     'configuration/.wizard-image-recovery.lock', 'configuration/.wizard-image-recovery.pending',
                     'configuration/preview-setup.json.lock'):
        path = root / relative
        require(not path.exists() and not path.is_symlink(), 'unfinished-operation-blocks-stopped-repair')
    # Passive project/bootstrapPending receipts are intentionally retained. They
    # are not proof of a live writer; the process, exec and operation guards are.
    if lease is None:
        guard = root / 'configuration/.controller-host-guard.lock'
        if guard.exists() or guard.is_symlink():
            descriptor = os.open(guard, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                info = os.fstat(descriptor)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                        'private-controller-host-guard-required')
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise recovery.RecoveryError('controller-host-command-or-coordinator-still-running') from None
            finally:
                os.close(descriptor)


def repair_baseline(config, baseline, services, lease=None):
    stopped_operations_idle(config, lease)
    runtime.assert_baseline(config, baseline)
    require(runtime.public_images(config, services) == baseline['selectedImages'],
            'controller-update-images-changed-before-stop')
    runtime.verify_management_routes(config)


def wait_ready(config, baseline, token_file, redirect_from, timeout):
    deadline = time.monotonic() + timeout
    previous_deadline = recovery.OPERATION_DEADLINE
    recovery.OPERATION_DEADLINE = min(previous_deadline, deadline) if previous_deadline else deadline
    try:
        while True:
            try:
                receipt = runtime.verify(config, baseline, ROOT, token_file, redirect_from, public=True)
                require(receipt['runnerManagers']['checked'], 'controller-update-runner-contact-proof-required')
                return receipt
            except Exception as error:
                if time.monotonic() >= deadline:
                    raise recovery.RecoveryError('controller-update-readiness-failed:' +
                        (str(error) if isinstance(error, recovery.RecoveryError) else type(error).__name__)) from None
                time.sleep(min(3, max(0, deadline - time.monotonic())))
    finally:
        recovery.OPERATION_DEADLINE = previous_deadline


def compose(config, reference):
    run([*DOCKER, 'compose', '--compatibility', '-p', 'system', '-f',
         str(ROOT / 'system/docker-compose.yml'), 'up', '--no-build', '--no-deps',
         '--pull', 'never', '-d', 'bootstrapper'], env=successor.environment(config, reference, staged=True))


def stop_controller(row):
    promoter.owned(row, 'bootstrapper')
    run([*DOCKER, 'update', '--restart=no', row['Id']])
    if row['State']['Running']:
        require(not row['State'].get('Paused'), 'controller-update-refuses-paused-controller')
        run([*DOCKER, 'stop', '--time', '30', row['Id']])
    require(not promoter.inspect(row['Id'])['State']['Running'], 'previous-controller-did-not-stop')


def write_configuration(config, raw, metadata):
    successor.atomic_bytes(config['_main'], raw, metadata['mode'])
    os.chown(config['_main'], metadata['uid'], metadata['gid'])


RELEASE_SELECTION = ('.release-images.json', '.release-images.env')


def release_selection(config):
    """Read bounded private files without following a selection symlink."""
    result, payloads = {}, {}
    for name in RELEASE_SELECTION:
        path = config['_main'].parent / name
        if not path.exists() and not path.is_symlink():
            result[name] = None
            continue
        raw = successor.private_input(path)
        info = path.stat()
        result[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'mode': stat.S_IMODE(info.st_mode),
                        'uid': info.st_uid, 'gid': info.st_gid}
        payloads[name] = raw
    return result, payloads


def prepare_release_selection(config, accepted, release, controller, wizard):
    before, payloads = release_selection(config)
    require(all(value is None for value in before.values()) or all(before.values()),
            'public-release-selection-incomplete')
    receipt = {'schemaVersion': 1, 'sourceCommit': release['sourceRevision'],
               'sourceTree': release['sourceTree'], 'wizardSourceRevision': release['wizardRevision'],
               'images': {'controller': controller, 'wizard': wizard}, 'status': 'selected',
               'selectedAt': runtime.now(), 'productRelease': {'version': accepted['version'],
                   'tag': accepted['tag'], 'sourceRevision': accepted['source']['revision']},
               'selectionOperation': 'accepted-public-controller-update'}
    after_payloads = {'.release-images.json': (json.dumps(receipt, indent=2) + '\n').encode(),
                      '.release-images.env': ('BOOTSTRAPPER_IMAGE=' + controller['reference'] +
                                              '\nWIZARD_IMAGE=' + wizard['reference'] + '\n').encode()}
    after = {name: {**(before[name] or {'mode': 0o600, 'uid': os.geteuid(), 'gid': os.getegid()}),
                    'sha256': hashlib.sha256(raw).hexdigest()} for name, raw in after_payloads.items()}
    return {'before': before, 'after': after}, payloads, after_payloads


def verify_release_selection(config, selection, rollback=False):
    current, _ = release_selection(config)
    for name in RELEASE_SELECTION:
        allowed = [selection['before'][name], selection['after'][name]] if rollback else [selection['before'][name]]
        require(current[name] in allowed, 'public-release-selection-changed')


def write_release_selection(config, checkpoint, selection, phase):
    # Both payloads were checkpointed before maintenance. A process loss between
    # atomic replacements is recoverable from either exact old/new file state.
    for name in RELEASE_SELECTION:
        path = config['_main'].parent / name
        metadata = selection[phase][name]
        if metadata is None:
            if path.exists():
                path.unlink()
                successor.directory_barrier(path.parent)
            continue
        raw = successor.private_input(checkpoint / (name + '.' + phase))
        require(hashlib.sha256(raw).hexdigest() == metadata['sha256'], 'public-release-selection-checkpoint-changed')
        successor.atomic_bytes(path, raw, metadata['mode'], (metadata['uid'], metadata['gid']))


def verify_release_selection_checkpoint(checkpoint, selection):
    for phase in ('before', 'after'):
        for name, metadata in selection[phase].items():
            if metadata is not None:
                raw = successor.private_input(checkpoint / (name + '.' + phase))
                require(hashlib.sha256(raw).hexdigest() == metadata['sha256'],
                        'public-release-selection-checkpoint-changed')


def update(config, release, evidence, api, release_bytes, evidence_bytes, security,
           controller, checkpoint, token_file, redirect_from=None, timeout=1200, check_only=False, wizard=None,
           release_metadata=None, repair_stopped_controller=False):
    runtime.public_manifest_absent(config)
    require(api.base == runtime.origin(config, 'GITLAB'), 'GitLab-origin-does-not-match-saved-config')
    successor.verify_checkout(release, ROOT)
    require(release_metadata is None or wizard is not None, 'release-metadata-requires-paired-update')
    require(not repair_stopped_controller or (wizard is not None and release_metadata is not None),
            'stopped-repair-requires-paired-accepted-release-metadata')
    pipeline = successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
    publication = None
    if wizard is not None:
        controller, wizard = installer.reference(controller), installer.reference(wizard)
        require(config.get('WIZARD_ENABLE') == 'true', 'paired-update-requires-enabled-Wizard')
        publication = successor.verify_public_pair(api, release, evidence, controller, wizard)
    stopped_id = None
    if repair_stopped_controller:
        stopped_id = promoter.inspect('system_bootstrapper_1')['Id']
        stopped_operations_idle(config)
    original = current_services(config, release, evidence, security, stopped_id)
    if wizard is not None:
        promoter.owned(original['system_wizard_1'], 'wizard')
    baseline = (runtime.capture(config, ROOT, public=True) if stopped_id is None else
                runtime.capture(config, ROOT, public=True, stopped_controller_id=stopped_id))
    require(len(baseline['runnerManagerIdentitySha256']) == runtime.runner_count(config),
            'all-current-runner-identities-required')
    if stopped_id is None:
        wait_ready(config, baseline, token_file, redirect_from, timeout)
        successor.sync_idle(config)
    else:
        repair_baseline(config, baseline, original)
    pulled = installer.checked_image(controller, {'sourceCommit': release['sourceRevision']})
    require(pulled['imageId'] == release['imageId'] and pulled['candidateJobId'] == release['candidateJobId'],
            'public-controller-does-not-match-accepted-candidate')
    pulled_wizard = None
    if wizard is not None:
        pulled_wizard = installer.checked_image(wizard, {'sourceCommit': release['sourceRevision'],
                                                        'wizardSourceRevision': release['wizardRevision']}, wizard=True)
        require(pulled_wizard['imageId'] == release['wizardImageId'] and
                pulled_wizard['candidateJobId'] == release['candidateJobId'],
                'public-Wizard-does-not-match-accepted-candidate')
    selection = None
    if release_metadata is not None:
        identity = {'sourceCommit': release['sourceRevision'], 'sourceTree': release['sourceTree'],
                    'wizardSourceRevision': release['wizardRevision']}
        accepted = installer.accepted_metadata(release_metadata, identity, controller, wizard)
        require(accepted['version'] == (ROOT / 'VERSION').read_text().strip() and
                accepted['acceptance'].get('evidenceSha256') == release['candidateEvidenceSha256'] and
                all(accepted['images'][role]['imageId'] == release[key] for role, key in
                    (('controller', 'imageId'), ('wizard', 'wizardImageId'))),
                'public-release-metadata-differs-from-accepted-candidate')
        require(all(selected['imageId'] in {accepted['images'][role]['imageId'],
                                            accepted['images'][role]['configDigest'],
                                            accepted['images'][role]['reference'].split('@')[1]} and
                    selected['candidateJobId'] == accepted['acceptance']['candidateJobId']
                    for role, selected in (('controller', pulled), ('wizard', pulled_wizard))),
                'pulled-images-differ-from-accepted-public-attempt')
        selection, selection_before, selection_after = prepare_release_selection(
            config, accepted, release, pulled, pulled_wizard)
    checkpoint = checkpoint_path(config, checkpoint, new=True)
    raw = config['_main'].read_bytes()
    updated = assignment(raw, pulled['reference'])
    if pulled_wizard:
        updated = assignment(updated, pulled_wizard['reference'], 'WIZARD_IMAGE')
    info = config['_main'].stat()
    metadata = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
    if check_only:
        return {'phase': 'preflight-passed', 'controller': pulled, 'pipeline': pipeline,
                **({'repairStoppedController': True} if stopped_id else {}),
                **({'wizard': pulled_wizard, 'publication': publication} if pulled_wizard else {}),
                **({'productRelease': {'version': accepted['version'], 'tag': accepted['tag']},
                    'releaseSelectionWillRefresh': True} if selection else {})}
    checkpoint.mkdir(parents=True, mode=0o700)
    checkpoint.chmod(0o700)
    successor.atomic_bytes(checkpoint / 'main-before.env', raw)
    successor.atomic_bytes(checkpoint / 'main-after.env', updated)
    successor.atomic_json(checkpoint / 'baseline-before.json', baseline)
    if selection:
        for phase, payloads in (('before', selection_before), ('after', selection_after)):
            for name, payload in payloads.items():
                successor.atomic_bytes(checkpoint / (name + '.' + phase), payload)
    record = {'format': 'system-public-controller-update-v1', 'phase': 'inputs-verified', 'at': runtime.now(),
              'release': release, 'pipeline': pipeline, 'controller': pulled,
              'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
              'configurationAfterSha256': hashlib.sha256(updated).hexdigest(),
              'configurationMetadata': metadata, 'previousController': {
                  'reference': config['BOOTSTRAPPER_IMAGE'], 'imageId': original['system_bootstrapper_1']['Image'],
                  'restartPolicy': original['system_bootstrapper_1']['HostConfig']['RestartPolicy']}}
    if stopped_id:
        record['repairStoppedController'] = True
        record['previousController'].update(containerId=stopped_id, state=original['system_bootstrapper_1']['State'])
        record['previousRunnerContainerIds'] = {name: row['Id'] for name, row in original.items()
                                                if name.startswith('runner_docker_')}
    if pulled_wizard:
        record.update(wizard=pulled_wizard, publication=publication,
                      previousWizard={'reference': config['WIZARD_IMAGE'],
                                      'imageId': original['system_wizard_1']['Image']})
    if selection:
        successor.atomic_json(checkpoint / 'accepted-public-release.json', accepted)
        record['releaseSelection'] = selection
    successor.atomic_json(checkpoint / 'operation.json', record)
    with successor.Lease(config) as lease:
        record.update(leaseOperation=lease.operation, phase='lease-acquired')
        successor.atomic_json(checkpoint / 'operation.json', record)
        runtime.assert_baseline(config, baseline)
        if selection:
            verify_release_selection(config, selection)
        if stopped_id is None:
            require(runtime.public_images(config, runtime.inspect_services(config)) == baseline['selectedImages'],
                    'controller-update-images-changed-before-stop')
        successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
        if pulled_wizard:
            require(successor.verify_public_pair(api, release, evidence, controller, wizard) == publication,
                    'paired-publication-changed-before-stop')
        if stopped_id is None:
            successor.sync_idle(config)
            current_services(config, release, evidence, security)
        else:
            current = current_services(config, release, evidence, security, stopped_id)
            require(current['system_bootstrapper_1'] == original['system_bootstrapper_1'],
                    'stopped-controller-changed-before-repair')
            verify_runner_containers(current, record['previousRunnerContainerIds'])
            repair_baseline(config, baseline, current, lease)
        if selection:
            verify_release_selection(config, selection)
            verify_release_selection_checkpoint(checkpoint, selection)
        lease.critical = True
        record['phase'] = 'controller-stop-started'
        successor.atomic_json(checkpoint / 'operation.json', record)
        stop_controller(original['system_bootstrapper_1'])
        runtime.assert_baseline(config, baseline)
        write_configuration(config, updated, metadata)
        if selection:
            write_release_selection(config, checkpoint, selection, 'after')
        record['phase'] = 'controller-start-started'
        successor.atomic_json(checkpoint / 'operation.json', record)
        restarted_at = runtime.now()
        compose(config, pulled['reference'])
        config = runtime.settings(config['_persistence_env'])
        after = copy.deepcopy(baseline)
        after['configurationFiles']['configuration/.docker.env'] = hashlib.sha256(updated).hexdigest()
        after['selectedImages']['system_bootstrapper_1'].update(reference=pulled['reference'], imageId=pulled['imageId'])
        if pulled_wizard:
            after['selectedImages']['system_wizard_1'].update(reference=pulled_wizard['reference'], imageId=pulled_wizard['imageId'])
        after.update(sourceCommit=release['sourceRevision'], sourceTree=release['sourceTree'])
        after['startedAt'] = restarted_at
        successor.atomic_json(checkpoint / 'baseline-after.json', after)
        receipt = wait_ready(config, after, token_file, redirect_from, timeout)
        services = runtime.inspect_services(config)
        unchanged_services(services, baseline, wizard_optional=bool(pulled_wizard))
        if stopped_id:
            verify_runner_containers(services, record['previousRunnerContainerIds'])
        successor.atomic_json(checkpoint / 'verification.json', receipt)
        record.update(phase='completed', completedAt=runtime.now(), serviceImagesPreserved=not bool(pulled_wizard),
                      configurationChangedOnlyControllerImage=not bool(pulled_wizard), databaseRewound=False)
        if pulled_wizard:
            record.update(otherServiceImagesPreserved=True, configurationChangedOnlyReleaseImages=True)
        successor.atomic_json(checkpoint / 'operation.json', record)
    return record


def load_operation(config, checkpoint):
    runtime.public_manifest_absent(config)
    checkpoint = checkpoint_path(config, checkpoint)
    record = json.loads(successor.private_input(checkpoint / 'operation.json'))
    require(record.get('format') == 'system-public-controller-update-v1', 'invalid-public-controller-operation')
    return checkpoint, record


def paired_rollback_baseline(config, baseline, record):
    if record.get('wizard'):
        current = copy.deepcopy(baseline)
        current['configurationFiles']['configuration/.docker.env'] = recovery.sha(config['_main'])
        runtime.assert_baseline(config, current)


def restore_stopped_controller(config, baseline, record, lease):
    """Restore selectors and a never-started old controller, not its failed code."""
    previous = record['previousController']
    require(previous['restartPolicy'].get('Name') == 'no', 'stopped-rollback-requires-original-no-restart')
    arguments = [*DOCKER, 'compose', '--compatibility', '-p', 'system', '-f',
                 str(ROOT / 'system/docker-compose.yml')]
    environment = successor.environment(config, previous['reference'], staged=True)
    run([*arguments, 'create', '--force-recreate', '--no-build', '--pull', 'never', 'bootstrapper'],
        env=environment)
    row = promoter.inspect('system_bootstrapper_1')
    promoter.owned(row, 'bootstrapper')
    require(row['Image'] == previous['imageId'] and row['State'].get('Status') == 'created' and
            row['State'].get('Pid') == 0 and row['State'].get('Running') is False,
            'stopped-rollback-controller-was-started-or-changed')
    run([*DOCKER, 'update', '--restart=no', row['Id']])
    if record.get('wizard'):
        run([*arguments, 'up', '--no-build', '--no-deps', '--pull', 'never', '-d', 'wizard'], env=environment)
    services = runtime.inspect_services(config, stopped_controller_id=row['Id'])
    stopped_services(services, row['Id'])
    verify_runner_containers(services, record['previousRunnerContainerIds'])
    unchanged_services(services, baseline)
    runtime.verify_mounts(config, services)
    repair_baseline(config, baseline, services, lease)
    return {'passed': True, 'at': runtime.now(), 'controllerStopped': True, 'controllerId': row['Id'],
            'controllerImageId': previous['imageId'], 'controllerStatus': 'created', 'syncAvailable': False,
            'wizardPublicRouteChecked': False, 'configurationUnchanged': True,
            'runnerContainerIds': record['previousRunnerContainerIds'],
            'runnerManagerIdentitySha256': baseline['runnerManagerIdentitySha256'],
            'runnerContactFreshnessChecked': False}


def rollback(config, checkpoint, token_file, redirect_from=None, timeout=1200):
    checkpoint, record = load_operation(config, checkpoint)
    require(record.get('phase') not in ('rolled-back', 'rolled-back-stopped') and record.get('leaseOperation'),
            'controller-update-not-rollbackable')
    successor.verify_checkout(record['release'], ROOT)
    before = successor.private_input(checkpoint / 'main-before.env')
    baseline = json.loads(successor.private_input(checkpoint / 'baseline-before.json'))
    require(hashlib.sha256(before).hexdigest() == record['configurationBeforeSha256'] and
            hashlib.sha256(config['_main'].read_bytes()).hexdigest() in
            (record['configurationBeforeSha256'], record['configurationAfterSha256']),
            'controller-rollback-configuration-changed')
    runtime.cube(before)
    selection = record.get('releaseSelection')
    if selection:
        verify_release_selection(config, selection, rollback=True)
        verify_release_selection_checkpoint(checkpoint, selection)
    previous = record['previousController']
    require(recovery.inspect_image(previous['reference'])['Id'] == previous['imageId'],
            'previous-controller-image-unavailable-or-retargeted')
    if record.get('wizard'):
        previous_wizard = record['previousWizard']
        require(recovery.inspect_image(previous_wizard['reference'])['Id'] == previous_wizard['imageId'],
                'previous-Wizard-image-unavailable-or-retargeted')
    paired_rollback_baseline(config, baseline, record)
    rollback_services(config, baseline, record)
    locked = (config['_root'] / 'configuration/.gitlab-upgrade-lock').exists()
    lease = successor.Lease.adopt(config, record['leaseOperation']) if locked else successor.Lease(config).__enter__()
    try:
        record['leaseOperation'] = lease.operation
        successor.atomic_json(checkpoint / 'operation.json', record)
        require(hashlib.sha256(config['_main'].read_bytes()).hexdigest() in
                (record['configurationBeforeSha256'], record['configurationAfterSha256']),
                'controller-rollback-configuration-changed')
        paired_rollback_baseline(config, baseline, record)
        if selection:
            verify_release_selection(config, selection, rollback=True)
            verify_release_selection_checkpoint(checkpoint, selection)
        services = rollback_services(config, baseline, record)
        if record.get('repairStoppedController'):
            stopped_operations_idle(config, lease)
            repair_peer_services(services)
            verify_runner_containers(services, record['previousRunnerContainerIds'])
            controller = services.get('system_bootstrapper_1')
            require(controller is None or ('ExecIDs' in controller and controller['ExecIDs'] in (None, [])),
                    'repair-controller-active-or-unknown-execs')
        record['phase'] = 'rollback-started'
        successor.atomic_json(checkpoint / 'operation.json', record)
        lease.critical = True
        if 'system_bootstrapper_1' in services:
            stop_controller(services['system_bootstrapper_1'])
        if record.get('repairStoppedController'):
            stopped_operations_idle(config, lease)
            stopped = rollback_services(config, baseline, record)
            repair_peer_services(stopped)
            verify_runner_containers(stopped, record['previousRunnerContainerIds'])
        write_configuration(config, before, record['configurationMetadata'])
        if selection:
            write_release_selection(config, checkpoint, selection, 'before')
        config = runtime.settings(config['_persistence_env'])
        if record.get('repairStoppedController'):
            receipt = restore_stopped_controller(config, baseline, record, lease)
        else:
            compose(config, previous['reference'])
            baseline['startedAt'] = runtime.now()
            receipt = wait_ready(config, baseline, token_file, redirect_from, timeout)
            unchanged_services(runtime.inspect_services(config), baseline)
            policy = previous['restartPolicy']['Name']
            require(policy in ('no', 'always', 'unless-stopped', 'on-failure'), 'invalid-original-restart-policy')
            retries = previous['restartPolicy'].get('MaximumRetryCount', 0)
            if policy == 'on-failure' and retries:
                policy += ':' + str(int(retries))
            run([*DOCKER, 'update', '--restart=' + policy, promoter.inspect('system_bootstrapper_1')['Id']])
        successor.atomic_json(checkpoint / 'rollback-verification.json', receipt)
        record.update(phase='rolled-back-stopped' if record.get('repairStoppedController') else 'rolled-back',
                      rolledBackAt=runtime.now(), databaseRewound=False)
        successor.atomic_json(checkpoint / 'operation.json', record)
    except BaseException:
        lease.__exit__(*sys.exc_info())
        raise
    else:
        lease.__exit__(None, None, None)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operation', choices=['update', 'status', 'rollback'], default='update')
    parser.add_argument('--persistence-env', required=True)
    parser.add_argument('--checkpoint-dir', required=True)
    parser.add_argument('--release')
    parser.add_argument('--evidence')
    parser.add_argument('--controller', help='Independently selected public Docker Hub digest for the accepted candidate.')
    parser.add_argument('--wizard', help='Opt in to the exact same-candidate public Wizard and paired rollback.')
    parser.add_argument('--release-metadata', help='Accepted public metadata for paired release-selection refresh and rollback.')
    parser.add_argument('--gitlab-url')
    parser.add_argument('--token-file', help='Private API token used for CI and current Runner-manager verification.')
    parser.add_argument('--redirect-from')
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--repair-stopped-controller', action='store_true',
                        help='Repair a positively quiescent failed public controller using an accepted paired release.')
    args = parser.parse_args()
    require(os.geteuid() == 0 and 60 <= args.timeout <= 3600, 'root-and-bounded-readiness-timeout-required')
    require(not args.check_only or args.operation == 'update', 'check-only-requires-update')
    require(not args.repair_stopped_controller or args.operation == 'update', 'stopped-repair-requires-update')
    config = runtime.settings(args.persistence_env)
    config['_persistence_env'] = args.persistence_env
    if args.operation == 'status':
        _, record = load_operation(config, args.checkpoint_dir)
        print(json.dumps({'phase': record['phase'], 'controller': record['controller'],
                          'previousControllerImageId': record['previousController']['imageId'],
                          **({'wizard': record['wizard'], 'previousWizardImageId': record['previousWizard']['imageId']}
                             if record.get('wizard') else {})}, indent=2))
        return
    require(bool(args.token_file), 'private-API-token-file-required')
    if args.operation == 'rollback':
        record = rollback(config, args.checkpoint_dir, args.token_file, args.redirect_from, args.timeout)
        print('Previous selectors and stopped controller restored; Sync remains unavailable; checkpoint retained.'
              if record['phase'] == 'rolled-back-stopped' else
              'Previous controller/configuration restored; service images/data preserved.')
        return
    require(all((args.release, args.evidence, args.controller, args.gitlab_url)), 'public-controller-release-inputs-required')
    release_bytes, evidence_bytes = successor.private_input(args.release), successor.private_input(args.evidence)
    security = json.loads((ROOT / 'gitlab/security-release.json').read_bytes())
    release, evidence = successor.release_inputs(release_bytes, evidence_bytes, security)
    api = successor.GitLab(args.gitlab_url, args.token_file)
    update(config, release, evidence, api, release_bytes, evidence_bytes, security, args.controller,
           args.checkpoint_dir, args.token_file, args.redirect_from, args.timeout, args.check_only, args.wizard,
           args.release_metadata, args.repair_stopped_controller)
    print(('Public controller/Wizard pair preflight passed.' if args.wizard else
           'Public controller preflight passed.') if args.check_only else
          ('Accepted public controller/Wizard pair updated; other service images/data preserved.' if args.wizard else
           'Accepted public controller updated; service images/data preserved.'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Controller update stopped: ' + (str(error) if isinstance(error, (recovery.RecoveryError, installer.ReleaseError))
                                               else type(error).__name__), file=sys.stderr)
        sys.exit(1)
