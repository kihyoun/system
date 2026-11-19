#!/usr/bin/env python3
"""Run the real public CLI in the existing owned candidate namespace.

Only unavailable future publication/download transport and host OS/systemd/mount
facts are adapted. Backup, paired updater, leases, journals, source checks,
service/data verification and offline archive rollback use production tools.
This synthetic future publication is never exported as release evidence.
"""
import copy
import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SOURCE / 'bootstrapper'))
import successor
from public_release import encoded


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SOURCE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


tool = load('candidate_public_upgrade_cli', 'bootstrapper/upgrade-release.py')


def publication(fixture):
    """A future publisher response with the prepared candidate's exact IDs."""
    contracts = load('candidate_future_publication', 'tests/bootstrapper/public-upgrade.py')
    metadata, proof, _ = contracts.fixture()
    spec, previous = fixture['spec'], fixture['previous']
    source = {'repository': previous['source']['repository'], 'revision': spec['sourceRevision'],
              'tree': spec['sourceTree'], 'wizardRevision': spec['wizardSourceRevision']}
    metadata.update(source=source, compatibility={'versions': ['24.04'], 'minimumMemoryGiB': 8})
    # The config comes from each prepared archive; the daemon's local ID can
    # instead name its manifest. Future publication transport remains synthetic.
    images = {role: {'reference': 'system-upgrade-fixture/' + role + '@' + spec['images'][key]['id'],
                     'imageId': spec['images'][key]['id'], 'configDigest': spec['images'][key]['configDigest']}
              for role, key in [('controller', 'candidate'), ('wizard', 'wizard')]}
    metadata['images'] = images
    release, evidence = proof['release'], proof['evidence']
    release.update(sourceRevision=source['revision'], sourceTree=source['tree'], wizardRevision=source['wizardRevision'],
                   **spec['ciIdentity'], imageId=images['controller']['imageId'], wizardImageId=images['wizard']['imageId'],
                   registryRepository='system-upgrade-fixture/controller', registryReference=images['controller']['reference'],
                   wizardRegistryReference=images['wizard']['reference'])
    security = json.loads((SOURCE / 'gitlab/security-release.json').read_bytes())
    upgrade = copy.deepcopy(fixture['gitlabUpgrade'])
    # Publication happens after this whole candidate succeeds. These fixture
    # gates model that future input, not a claim that this stage already passed.
    upgrade.update(rollbackVerified=True, runnerManagerIdentityPreserved=True)
    evidence.update(sourceRevision=source['revision'], runId=fixture['runId'],
                    images={role: value['id'] for role, value in spec['images'].items()})
    evidence['evidence']['gitlabUpgrade'] = upgrade
    evidence['results'].append({'name': 'gitlab-upgrade-security-trust', 'status': 'passed'})
    evidence['evidence']['publicUpgrade'].update(fromVersion=previous['version'], toVersion=metadata['version'],
        fromSourceRevision=previous['source']['revision'], fromControllerImageId=previous['images']['controller']['imageId'],
        fromWizardImageId=previous['images']['wizard']['imageId'])
    release['candidateEvidenceSha256'] = hashlib.sha256(encoded(evidence)).hexdigest()
    metadata['acceptance'].update(candidateJobId=release['candidateJobId'], evidenceSha256=release['candidateEvidenceSha256'])
    for index, job in enumerate(proof['publication']['jobs']):
        job.update(pipelineId=release['pipelineId'], sourceRevision=source['revision'],
                   id=release['candidateJobId'] if job['name'] == 'test:platform-candidate' else 100000 + index)
    proof.update(source=source, images=images, originalEvidenceSha256=metadata['acceptance']['evidenceSha256'])
    raw_proof = encoded(proof)
    metadata['publicUpgrade'] = {'file': 'system-upgrade-v' + metadata['version'] + '.json',
        'format': proof['format'], 'sha256': hashlib.sha256(raw_proof).hexdigest()}
    return metadata, raw_proof, security


def main():
    fixture_dir = Path(os.environ['SYSTEM_PUBLIC_UPGRADE_FIXTURE'])
    fixture = json.loads((fixture_dir / 'fixture.json').read_bytes())
    target, proof, _ = publication(fixture)
    previous = fixture['previous']
    selection_files = ['.release-images.json', '.release-images.env', '.release-images.recovered.json']
    if sys.argv[1:2] == ['restore-original']:
        original = json.loads((fixture_dir / 'original-selection.json').read_bytes())
        for name, content in original.items():
            filename = Path(fixture['live']) / 'configuration' / name
            if content is None:
                filename.unlink(missing_ok=True)
            else:
                successor.atomic_bytes(filename, base64.b64decode(content))
        print(json.dumps({'restored': True}))
        return
    if sys.argv[1:2] == ['initialize']:
        live = Path(fixture['live'])
        main_file = live / 'configuration/.docker.env'
        successor.atomic_json(fixture_dir / 'original-selection.json', {name:
            base64.b64encode(successor.private_input(main_file.parent / name)).decode() if (main_file.parent / name).exists() else None
            for name in selection_files})
        raw = main_file.read_bytes()
        for role, key in [('controller', 'BOOTSTRAPPER_IMAGE'), ('wizard', 'WIZARD_IMAGE')]:
            raw = tool.updater.assignment(raw, previous['images'][role]['reference'], key)
        successor.atomic_bytes(main_file, raw)
        successor.atomic_json(main_file.parent / '.release-images.json', {
            'schemaVersion': 1, 'sourceCommit': previous['source']['revision'], 'sourceTree': previous['source']['tree'],
            'wizardSourceRevision': previous['source']['wizardRevision'], 'images': previous['images'],
            'productRelease': {'version': previous['version'], 'tag': previous['tag']}})
        successor.atomic_bytes(main_file.parent / '.release-images.env', ''.join(key + '=' +
            tool.updater.installer.reference(previous['images'][role]['reference']) + '\n' for role, key in
            [('controller', 'BOOTSTRAPPER_IMAGE'), ('wizard', 'WIZARD_IMAGE')]).encode())
        print(json.dumps({'initialized': True}))
        return
    def fetch(repository, tag, filename):
        successor.require(repository == previous['source']['repository'].removeprefix('https://github.com/').removesuffix('.git'),
                          'candidate-public-repository-mismatch')
        if tag == previous['tag'] and filename == 'system-release-' + previous['tag'] + '.json':
            return encoded(previous)
        if tag == target['tag'] and filename == 'system-release-' + target['tag'] + '.json':
            return encoded(target)
        successor.require(tag == target['tag'] and filename == target['publicUpgrade']['file'], 'candidate-public-asset-mismatch')
        return proof
    tool.fetch = fetch
    tool.platform.freedesktop_os_release = lambda: {'ID': 'ubuntu', 'VERSION_ID': '24.04'}
    native_run = tool.runtime.run
    def run(arguments, **options):
        if arguments[:2] == ['systemctl', 'is-active']:
            return b'active\n'
        if arguments[:2] == ['systemctl', 'show']:
            return b'fixture-host-timer-scheduled\n'
        return native_run(arguments, **options)
    tool.runtime.run = run
    certificate_state = Path(fixture['live']) / 'host/letsencrypt'
    if not Path('/etc/letsencrypt').exists():
        os.symlink(certificate_state, '/etc/letsencrypt')
    output = io.StringIO()
    with redirect_stdout(output):
        tool.main()
    raw = output.getvalue()
    print(json.dumps(json.loads(raw[raw.rfind('\n{') + 1:])))


if __name__ == '__main__':
    main()
