#!/usr/bin/env python3
"""Record the running accepted successor as explicit retained-volume inputs."""
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import uuid

sys.dont_write_bytecode = True
import successor

runtime, recovery = successor.runtime, successor.recovery
require, run, DOCKER = successor.require, successor.run, successor.DOCKER


def inspect_container(name):
    rows = json.loads(run([*DOCKER, 'inspect', name]))
    require(len(rows) == 1 and rows[0].get('State', {}).get('Running'), 'running-owned-container-required')
    return rows[0]


def source_identity(checkout):
    return recovery.host_operation('source', checkout)


def refreshed_manifest(previous, archive, source, controller_reference, controller_image,
                       gitlab_reference, gitlab_image, wizard_reference,
                       runner_reference=None, runner_image=None):
    return recovery.host_operation('refreshRecoveryManifest', previous, archive, source,
        controller_reference, controller_image, gitlab_reference, gitlab_image, wizard_reference,
        runner_reference, runner_image)


def save_archive(directory, reference, image, source):
    source = recovery.host_operation('recoverySource', source)
    relative = 'images/controller-' + source['sourceCommit'][:12] + '-' + image.split(':')[1][:12] + '-' + uuid.uuid4().hex[:12] + '.tar.gz'
    target = directory / relative
    require(not target.exists() and not target.is_symlink(), 'new-recovery-archive-path-required')
    temporary = target.with_name('.' + target.name + '.tmp-' + uuid.uuid4().hex)
    process = subprocess.Popen([*DOCKER, 'image', 'save', reference], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL)
    timed_out = threading.Event()
    def expire():
        timed_out.set()
        try:
            process.kill()
        except ProcessLookupError:
            pass
    timer = threading.Timer(300, expire)
    timer.daemon = True
    timer.start()
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as destination:
            with gzip.GzipFile(fileobj=destination, mode='wb', filename='', mtime=0) as compressed:
                shutil.copyfileobj(process.stdout, compressed, length=1024 * 1024)
            destination.flush()
            os.fsync(destination.fileno())
        process.stdout.close()
        require(process.wait(timeout=10) == 0 and not timed_out.is_set(), 'controller-image-archive-failed-or-timed-out')
        os.replace(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except Exception:
        if process.poll() is None:
            process.kill()
            process.wait()
        raise
    finally:
        timer.cancel()
        if temporary.exists():
            temporary.unlink()
    return {'file': relative, 'sha256': recovery.sha(target), 'bytes': target.stat().st_size,
            'imageId': image, **source}


def publish_manifest(directory, value, checkout, configuration, previous_bytes):
    candidate = (json.dumps(value, indent=2) + '\n').encode()
    # Validate the candidate in memory against actual archives, source objects
    # and saved selectors before its atomic publication. A crash can leave only
    # the old valid manifest or the new already validated manifest selected.
    recovery.load_manifest(directory, checkout, manifest_bytes=candidate)
    recovery.validate_selected_images(value, configuration)
    require((directory / 'images.json').read_bytes() == previous_bytes,
            'recovery-manifest-changed-before-publication')
    history = directory / 'manifest-history'
    history.mkdir(mode=0o700, exist_ok=True)
    require(not history.is_symlink(), 'manifest-history-must-not-be-symlink')
    saved = history / ('images-' + hashlib.sha256(previous_bytes).hexdigest() + '.json')
    if not saved.exists():
        successor.atomic_bytes(saved, previous_bytes)
    else:
        require(saved.read_bytes() == previous_bytes, 'previous-recovery-history-hash-mismatch')
    successor.atomic_bytes(directory / 'images.json', candidate)


def record(config, release, evidence, output):
    checkout, root = successor.HERE.parent, config['_root']
    successor.verify_checkout(release, checkout)
    source = source_identity(checkout)
    directory = root / 'recovery'
    previous_bytes = (directory / 'images.json').read_bytes()
    previous = recovery.load_manifest(directory, checkout)
    controller = inspect_container('system_bootstrapper_1')
    gitlab = inspect_container('system_gitlab_1')
    labels = controller.get('Config', {}).get('Labels', {})
    require(labels.get('com.docker.compose.project') == 'system' and
            labels.get('com.docker.compose.service') == 'bootstrapper', 'owned-controller-required')
    require(controller['Image'] == release['imageId'], 'running-controller-is-not-accepted-successor')
    reference = config['BOOTSTRAPPER_IMAGE']
    require(reference == successor.controller_alias(release), 'saved-controller-is-not-accepted-successor')
    require(recovery.inspect_image(reference)['Id'] == controller['Image'] and
            recovery.inspect_image(release['registryReference'])['Id'] == controller['Image'] and
            release['registryReference'] in recovery.inspect_image(release['registryReference']).get('RepoDigests', []),
            'controller-registry-pin-mismatch')
    upgrade = evidence['evidence']['gitlabUpgrade']
    require(gitlab['Image'] == upgrade['toImageId'] and config['GITLAB_IMAGE'] == upgrade['toImage'],
            'recovery-export-requires-completed-security-migration')
    selected = recovery.inspect_image(config['GITLAB_IMAGE'])
    require(selected['Id'] == gitlab['Image'] and recovery.canonical_digest(config['GITLAB_IMAGE']) in
            selected.get('RepoDigests', []), 'running-GitLab-does-not-match-pinned-config')
    require(config['GITLAB_RUNNER_IMAGE'] == upgrade['runnerImage'],
            'recovery-export-requires-completed-runner-upgrade')
    runner = recovery.inspect_image(config['GITLAB_RUNNER_IMAGE'])
    require(runner['Id'] == upgrade['runnerImageId'] and
            recovery.canonical_digest(config['GITLAB_RUNNER_IMAGE']) in runner.get('RepoDigests', []),
            'running-Runner-does-not-match-pinned-config')
    services = runtime.inspect_services(config)
    for index in range(1, runtime.runner_count(config) + 1):
        require(services[f'runner_docker_{index}']['Image'] == runner['Id'],
                'recovery-export-requires-completed-runner-upgrade')
    runtime.verify_mounts(config, services)
    with successor.Lease(config):
        successor.sync_idle(config)
        before = config['_main'].read_bytes()
        archive = save_archive(directory, reference, controller['Image'], source)
        value = refreshed_manifest(previous, archive, source, reference, controller['Image'],
                                   config['GITLAB_IMAGE'], gitlab['Image'], config['WIZARD_IMAGE'],
                                   config['GITLAB_RUNNER_IMAGE'], runner['Id'])
        value['currentController']['registryReference'] = release['registryReference']
        require(config['_main'].read_bytes() == before and inspect_container('system_gitlab_1')['Image'] == gitlab['Image'],
                'configuration-or-GitLab-changed-during-recovery-export')
        publish_manifest(directory, value, checkout, config['_main'], previous_bytes)
        result = {'format': 'system-recovery-export-v1', 'at': runtime.now(),
                  'sourceRevision': source['sourceCommit'], 'controllerImageId': controller['Image'],
                  'GitLabImageId': gitlab['Image'], 'manifestSha256': recovery.sha(directory / 'images.json'),
                  'runnerImageId': runner['Id'],
                  'controllerArchive': archive['file'], 'previousManifestRetained': True,
                  'savedConfigurationUnchanged': config['_main'].read_bytes() == before}
        successor.atomic_json(output, result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--persistence-env', required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--gitlab-url', required=True)
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'recovery-export-requires-root')
    config = runtime.settings(args.persistence_env)
    require(args.gitlab_url.rstrip('/') == runtime.origin(config, 'GITLAB'), 'GitLab-origin-does-not-match-saved-config')
    security = json.loads((successor.HERE.parent / 'gitlab/security-release.json').read_bytes())
    release_bytes, evidence_bytes = successor.private_input(args.release), successor.private_input(args.evidence)
    release, evidence = successor.release_inputs(release_bytes, evidence_bytes, security)
    successor.verify_pipeline(successor.GitLab(args.gitlab_url, args.token_file), release, release_bytes, evidence_bytes)
    record(config, release, evidence, args.output)
    print('Accepted successor recovery images and source identities recorded.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Recovery export stopped: ' + (str(error) if isinstance(error, recovery.RecoveryError)
                                              else type(error).__name__), file=sys.stderr)
        raise SystemExit(1)
