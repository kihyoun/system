#!/usr/bin/env python3
"""Update a public controller while preserving already-current service images/data.

This explicit path requires no archive recovery manifest and refuses an existing
one. Opt in to the accepted public Wizard with --wizard. Neither mode migrates
GitLab or restores a Seed.
"""
import argparse
import copy
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


def current_services(config, release, evidence, security):
    services = runtime.inspect_services(config)
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
    return services


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


def update(config, release, evidence, api, release_bytes, evidence_bytes, security,
           controller, checkpoint, token_file, redirect_from=None, timeout=1200, check_only=False, wizard=None):
    runtime.public_manifest_absent(config)
    require(api.base == runtime.origin(config, 'GITLAB'), 'GitLab-origin-does-not-match-saved-config')
    successor.verify_checkout(release, ROOT)
    pipeline = successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
    publication = None
    if wizard is not None:
        controller, wizard = installer.reference(controller), installer.reference(wizard)
        require(config.get('WIZARD_ENABLE') == 'true', 'paired-update-requires-enabled-Wizard')
        publication = successor.verify_public_pair(api, release, evidence, controller, wizard)
    original = current_services(config, release, evidence, security)
    if wizard is not None:
        promoter.owned(original['system_wizard_1'], 'wizard')
    baseline = runtime.capture(config, ROOT, public=True)
    require(len(baseline['runnerManagerIdentitySha256']) == runtime.runner_count(config),
            'all-current-runner-identities-required')
    wait_ready(config, baseline, token_file, redirect_from, timeout)
    successor.sync_idle(config)
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
    checkpoint = checkpoint_path(config, checkpoint, new=True)
    raw = config['_main'].read_bytes()
    updated = assignment(raw, pulled['reference'])
    if pulled_wizard:
        updated = assignment(updated, pulled_wizard['reference'], 'WIZARD_IMAGE')
    info = config['_main'].stat()
    metadata = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
    if check_only:
        return {'phase': 'preflight-passed', 'controller': pulled, 'pipeline': pipeline,
                **({'wizard': pulled_wizard, 'publication': publication} if pulled_wizard else {})}
    checkpoint.mkdir(parents=True, mode=0o700)
    checkpoint.chmod(0o700)
    successor.atomic_bytes(checkpoint / 'main-before.env', raw)
    successor.atomic_bytes(checkpoint / 'main-after.env', updated)
    successor.atomic_json(checkpoint / 'baseline-before.json', baseline)
    record = {'format': 'system-public-controller-update-v1', 'phase': 'inputs-verified', 'at': runtime.now(),
              'release': release, 'pipeline': pipeline, 'controller': pulled,
              'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
              'configurationAfterSha256': hashlib.sha256(updated).hexdigest(),
              'configurationMetadata': metadata, 'previousController': {
                  'reference': config['BOOTSTRAPPER_IMAGE'], 'imageId': original['system_bootstrapper_1']['Image'],
                  'restartPolicy': original['system_bootstrapper_1']['HostConfig']['RestartPolicy']}}
    if pulled_wizard:
        record.update(wizard=pulled_wizard, publication=publication,
                      previousWizard={'reference': config['WIZARD_IMAGE'],
                                      'imageId': original['system_wizard_1']['Image']})
    successor.atomic_json(checkpoint / 'operation.json', record)
    with successor.Lease(config) as lease:
        record.update(leaseOperation=lease.operation, phase='lease-acquired')
        successor.atomic_json(checkpoint / 'operation.json', record)
        runtime.assert_baseline(config, baseline)
        require(runtime.public_images(config, runtime.inspect_services(config)) == baseline['selectedImages'],
                'controller-update-images-changed-before-stop')
        successor.verify_pipeline(api, release, release_bytes, evidence_bytes)
        if pulled_wizard:
            require(successor.verify_public_pair(api, release, evidence, controller, wizard) == publication,
                    'paired-publication-changed-before-stop')
        successor.sync_idle(config)
        current_services(config, release, evidence, security)
        lease.critical = True
        record['phase'] = 'controller-stop-started'
        successor.atomic_json(checkpoint / 'operation.json', record)
        stop_controller(original['system_bootstrapper_1'])
        runtime.assert_baseline(config, baseline)
        write_configuration(config, updated, metadata)
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
        unchanged_services(runtime.inspect_services(config), baseline, wizard_optional=bool(pulled_wizard))
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


def rollback(config, checkpoint, token_file, redirect_from=None, timeout=1200):
    checkpoint, record = load_operation(config, checkpoint)
    require(record.get('phase') != 'rolled-back' and record.get('leaseOperation'), 'controller-update-not-rollbackable')
    successor.verify_checkout(record['release'], ROOT)
    before = successor.private_input(checkpoint / 'main-before.env')
    baseline = json.loads(successor.private_input(checkpoint / 'baseline-before.json'))
    require(hashlib.sha256(before).hexdigest() == record['configurationBeforeSha256'] and
            hashlib.sha256(config['_main'].read_bytes()).hexdigest() in
            (record['configurationBeforeSha256'], record['configurationAfterSha256']),
            'controller-rollback-configuration-changed')
    runtime.cube(before)
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
        services = rollback_services(config, baseline, record)
        record['phase'] = 'rollback-started'
        successor.atomic_json(checkpoint / 'operation.json', record)
        lease.critical = True
        if 'system_bootstrapper_1' in services:
            stop_controller(services['system_bootstrapper_1'])
        write_configuration(config, before, record['configurationMetadata'])
        config = runtime.settings(config['_persistence_env'])
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
        record.update(phase='rolled-back', rolledBackAt=runtime.now(), databaseRewound=False)
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
    parser.add_argument('--gitlab-url')
    parser.add_argument('--token-file', help='Private API token used for CI and current Runner-manager verification.')
    parser.add_argument('--redirect-from')
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0 and 60 <= args.timeout <= 3600, 'root-and-bounded-readiness-timeout-required')
    require(not args.check_only or args.operation == 'update', 'check-only-requires-update')
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
        rollback(config, args.checkpoint_dir, args.token_file, args.redirect_from, args.timeout)
        print('Previous controller/configuration restored; service images/data preserved.')
        return
    require(all((args.release, args.evidence, args.controller, args.gitlab_url)), 'public-controller-release-inputs-required')
    release_bytes, evidence_bytes = successor.private_input(args.release), successor.private_input(args.evidence)
    security = json.loads((ROOT / 'gitlab/security-release.json').read_bytes())
    release, evidence = successor.release_inputs(release_bytes, evidence_bytes, security)
    api = successor.GitLab(args.gitlab_url, args.token_file)
    update(config, release, evidence, api, release_bytes, evidence_bytes, security, args.controller,
           args.checkpoint_dir, args.token_file, args.redirect_from, args.timeout, args.check_only, args.wizard)
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
