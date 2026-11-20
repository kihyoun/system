#!/usr/bin/env python3
"""Run the real public CLI in the existing owned candidate namespace.

Only unavailable future publication/download transport and host OS/systemd/mount
facts are adapted. Backup, paired updater, leases, journals, source checks,
service/data verification and offline archive rollback use production tools.
This synthetic future publication is never exported as release evidence.
"""
import copy
import base64
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
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
DIAGNOSTICS = json.loads((SOURCE / 'tests/e2e/public-upgrade-diagnostics.json').read_bytes())
DOCKER_OPERATION_FRAMES = (
    (tool.data_sample.__code__, 'data-sample'),
    (tool.updater.compose.__code__, 'compose-up'),
    (tool.updater.stop_controller.__code__, 'controller-stop'),
    (tool.installed.__code__, 'installed-check'),
    (tool.updater.update.__code__, 'update-preflight'),
)


def diagnostic_code(error):
    if isinstance(error, (successor.recovery.RecoveryError, tool.updater.installer.ReleaseError)):
        code = DIAGNOSTICS['errors'].get(str(error))
        if code:
            if isinstance(error, successor.recovery.RecoveryError) and str(error) == 'command-failed:docker':
                # Code identity admits only the loaded repository functions,
                # including when another frame spoofs their filename/name.
                # Keep the innermost known operation; inspect no command data.
                trace = error.__traceback__
                while trace is not None:
                    for frame, operation in DOCKER_OPERATION_FRAMES:
                        if trace.tb_frame.f_code is frame and (operation != 'update-preflight' or
                                trace.tb_frame.f_locals.get('check_only') is True):
                            code = DIAGNOSTICS['dockerOperations'][operation]
                    trace = trace.tb_next
            return code
    return DIAGNOSTICS['exceptionTypes'].get(type(error).__name__, DIAGNOSTICS['fallback'])


def entrypoint():
    # Importing the production CLI bypasses its __main__ formatter. Carry only
    # source-owned fixed diagnostics through the driver's existing line matcher.
    output = io.StringIO()
    try:
        with redirect_stdout(output), redirect_stderr(io.StringIO()):
            main()
    except Exception as error:
        print(DIAGNOSTICS['marker'] + diagnostic_code(error), file=sys.stderr)
        return 1
    print(output.getvalue(), end='')
    return 0


def previous_configuration(raw, fixture):
    """Translate only this harness's exact candidate selector into its baseline.

    The public updater deliberately rejects an existing bare image ID. The
    disposable platform starts with precisely that selector, before this fixture
    installs the previous official pair. Keep that exception test-only.
    """
    expected = fixture['spec']['images']['candidate']['id']
    successor.require(re.fullmatch(r'sha256:[a-f0-9]{64}', expected), 'candidate-controller-image-id-required')
    matches = list(re.finditer(rb'(?m)^(?:export )?BOOTSTRAPPER_IMAGE=.*(?:\n|$)', raw))
    successor.require(len(matches) == 1 and matches[0].start() >= 1184,
                      'candidate-controller-assignment-required')
    record = matches[0]
    selected = record.group().removesuffix(b'\n').split(b'=', 1)[1]
    successor.require(selected in (expected.encode(), ("'" + expected + "'").encode(),
                                  ('"' + expected + '"').encode()), 'candidate-controller-selector-mismatch')
    reference = tool.updater.installer.reference(fixture['previous']['images']['controller']['reference'])
    successor.runtime.cube(raw)
    raw = raw[:record.start()] + ("export BOOTSTRAPPER_IMAGE='" + reference + "'").encode() + (
        b'\n' if record.group().endswith(b'\n') else b'') + raw[record.end():]
    # The production parser validates the entire resulting configuration and
    # performs both public selections without relaxing its existing contract.
    for role, key in [('controller', 'BOOTSTRAPPER_IMAGE'), ('wizard', 'WIZARD_IMAGE')]:
        raw = tool.updater.assignment(raw, fixture['previous']['images'][role]['reference'], key)
    return raw


def publication(fixture):
    """A future publisher response with the prepared candidate's exact IDs."""
    contracts = load('candidate_future_publication', 'tests/bootstrapper/public-upgrade.py')
    metadata, proof, _ = contracts.fixture()
    spec, previous = fixture['spec'], fixture['previous']
    if fixture.get('edge'):
        metadata.update(version=fixture['edge']['to'], tag='v' + fixture['edge']['to'])
        proof['version'] = metadata['version']
        proof['evidence']['results'] = [row for row in proof['evidence']['results'] if not row['name'].startswith('public-release-upgrade-')]
        proof['evidence']['results'].append({'name': fixture['edge']['requiredStage'], 'status': 'passed'})
    source = {'repository': previous['source']['repository'], 'revision': spec['sourceRevision'],
              'tree': spec['sourceTree']}
    shared = spec.get('sourceLayout') == 'system-monorepo-v1'
    source.update({'sourceLayout': 'system-monorepo-v1', 'wizardSourceTree': spec['wizardSourceTree']} if shared else {'wizardRevision': spec['wizardSourceRevision']})
    metadata.update(source=source, compatibility={'versions': ['24.04'], 'minimumMemoryGiB': 8})
    # The config comes from each prepared archive; the daemon's local ID can
    # instead name its manifest. Future publication transport remains synthetic.
    images = {role: {'reference': 'system-upgrade-fixture/' + role + '@' + spec['images'][key]['id'],
                     'imageId': spec['images'][key]['id'], 'configDigest': spec['images'][key]['configDigest']}
              for role, key in [('controller', 'candidate'), ('wizard', 'wizard')]}
    metadata['images'] = images
    release, evidence = proof['release'], proof['evidence']
    release.update(sourceRevision=source['revision'], sourceTree=source['tree'],
                   **spec['ciIdentity'], imageId=images['controller']['imageId'], wizardImageId=images['wizard']['imageId'],
                   registryRepository='system-upgrade-fixture/controller', registryReference=images['controller']['reference'],
                   wizardRegistryReference=images['wizard']['reference'])
    if shared:
        release.pop('wizardRevision', None)
        release.update(sourceLayout='system-monorepo-v1', wizardSourceTree=source['wizardSourceTree'])
    else:
        release.update(wizardRevision=source['wizardRevision'])
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
    if any(edge.get('databaseMigration') and edge['to'] == metadata['version'] for edge in proof['graph']['transitions']):
        checkpoint = str(Path(fixture['live']) / 'configuration/gitlab-upgrades' / ('candidate-' + fixture['runId']))
        prerequisite = successor.recovery.host_operation('gitlabUpgradePrerequisite', fixture['live'], checkpoint,
            spec['sourceRevision'], security)
        evidence['evidence']['publicUpgrade'].update(gitlabPrerequisiteVerified=True,
            gitlabCheckpointSha256=prerequisite['checkpointSha256'],
            gitlabFromVersion=prerequisite['fromVersion'], gitlabToVersion=prerequisite['toVersion'])
    if shared:
        origin = fixture['guidedOrigin']
        successor.require(origin['guidedPreview']['version'] == 2 and origin['runId'] != fixture['runId'], 'shared-beta-origin-required')
        evidence.update(sourceLayout='system-monorepo-v1', sourceTree=spec['sourceTree'], wizardSourceTree=spec['wizardSourceTree'], ciIdentity=spec['ciIdentity'])
        evidence['evidence']['recovery'] = {'guidedBindingRestored': True}
        evidence['guidedPreviewReceipt'] = {
            'format': 'system-guided-preview-origin-v1', 'runId': origin['runId'],
            'sourceLayout': 'system-monorepo-v1', 'sourceRevision': source['revision'],
            'sourceTree': spec['sourceTree'], 'wizardSourceTree': spec['wizardSourceTree'],
            'fullAcceptance': True, 'ciIdentity': spec['ciIdentity'], 'images': evidence['images'],
            'results': origin['results'], 'evidence': {'guidedPreview': origin['guidedPreview'],
                'gitlabUpgrade': upgrade, 'recovery': {'runId': fixture['runId'], 'backupOnly': True,
                    'originalHostRemoved': True, 'guidedBindingRestored': True}}}
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
        raw = previous_configuration(main_file.read_bytes(), fixture)
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
    target, proof, _ = publication(fixture)
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
    sys.exit(entrypoint())
