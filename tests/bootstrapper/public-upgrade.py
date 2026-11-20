#!/usr/bin/env python3
"""Public provenance authority, exact graph, backup pairing and fail-closed plans."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import shutil
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
from types import SimpleNamespace
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bootstrapper'))
import successor
import upgrade_paths
from public_release import PublicReleaseAuthority, encoded


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


fixtures = load('public_upgrade_fixtures', ROOT / 'tests/bootstrapper/successor-host-tools.py')
tool = load('public_upgrade_tool', ROOT / 'bootstrapper/upgrade-release.py')
inspect_retained_image = successor.recovery.inspect_image


def fixture():
    release, evidence, security = fixtures.fixture()
    # The shared fixture contains set-derived maps. Publication is regenerated
    # in separate CLI processes, so stabilize bytes before hashing evidence.
    evidence = json.loads(json.dumps(evidence, sort_keys=True))
    release.update(wizardImageId='sha256:' + '8' * 64, registryRepository='example/system',
                   registryReference='example/system@sha256:' + 'e' * 64,
                   wizardRegistryReference='example/wizard@sha256:' + '9' * 64)
    graph = upgrade_paths.load()
    edge = graph['transitions'][0]
    evidence['results'].append({'name': edge['requiredStage'], 'status': 'passed'})
    evidence['images']['wizard'] = release['wizardImageId']
    evidence['evidence']['publicUpgrade'] = {'fromVersion': edge['from'], 'toVersion': edge['to'],
        'fromSourceRevision': '0' * 40, 'fromControllerImageId': 'sha256:' + '0' * 64,
        'fromWizardImageId': 'sha256:' + '1' * 64,
        **{key: True for key in ('dataPreserved', 'configurationPreserved', 'runnerRegistryVerified', 'rollbackVerified')}}
    release['candidateEvidenceSha256'] = hashlib.sha256(encoded(evidence)).hexdigest()
    metadata = {'format': 'system-accepted-release-v1', 'version': edge['to'], 'tag': 'v' + edge['to'],
        'platform': 'linux/amd64', 'source': {'revision': release['sourceRevision'], 'tree': release['sourceTree'],
            'wizardRevision': release['wizardRevision'], 'repository': 'https://github.com/example/system.git'},
        'images': {role: {'reference': release[key], 'imageId': release[idkey], 'configDigest': release[idkey]}
                   for role, key, idkey in [('controller', 'registryReference', 'imageId'), ('wizard', 'wizardRegistryReference', 'wizardImageId')]},
        'acceptance': {'evidenceSha256': 'f' * 64, 'candidateJobId': release['candidateJobId'],
                       'requiredChecksPassed': True, 'controllerWizardSameAttempt': True}}
    names = sorted(successor.REQUIRED_JOBS) + ['test:wizard-browser', 'test:codeql', 'deploy:dockerhub', 'deploy:github']
    names += ['test:isolated: [' + component + ']' for component in sorted(successor.COMPONENTS)]
    jobs = [{'id': release['candidateJobId'] if name == 'test:platform-candidate' else index + 100,
             'name': name, 'status': 'success', 'allow_failure': False,
             'pipelineId': release['pipelineId'], 'sourceRevision': release['sourceRevision']} for index, name in enumerate(names)]
    proof = {'format': 'system-public-upgrade-provenance-v1', 'version': metadata['version'],
        'source': metadata['source'], 'images': metadata['images'], 'originalEvidenceSha256': metadata['acceptance']['evidenceSha256'],
        'publication': {'protectedDefaultBranch': True, 'requiredMergeGate': True, 'nativePush': True, 'jobs': jobs},
        'graph': graph, 'release': release, 'evidence': evidence}
    return metadata, proof, security


def authority(metadata, proof, security):
    raw = encoded(proof)
    metadata = copy.deepcopy(metadata)
    metadata['publicUpgrade'] = {'file': 'system-upgrade-v' + metadata['version'] + '.json',
        'format': proof['format'], 'sha256': hashlib.sha256(raw).hexdigest()}
    return PublicReleaseAuthority(metadata, raw, 'https://operator-gitlab.example.invalid', security)


class NativeFixtureInitialization(unittest.TestCase):
    def test_helper_formatter_emits_only_fixed_diagnostics_and_never_tracebacks(self):
        adapter = load('native_public_fixture_diagnostics', ROOT / 'tests/e2e/public-upgrade-host.py')
        cases = [
            (successor.recovery.RecoveryError('successor-checkout-is-modified'), 'checkout-modified'),
            (adapter.tool.updater.installer.ReleaseError('public-dockerhub-digest-required'), 'public-image-reference-invalid'),
            (successor.recovery.RecoveryError('command-failed:docker'), 'docker-command-failed'),
            (successor.recovery.RecoveryError('command-failed:/private/credential'), 'unclassified-error'),
            (successor.recovery.RecoveryError('private-token\nSYSTEM_PUBLIC_UPGRADE_DIAGNOSTIC checkout-modified'), 'unclassified-error'),
            (RuntimeError('private-token'), 'unclassified-error'),
            (KeyError('private-token'), 'required-field-missing'),
            (FileNotFoundError('/private/credential'), 'file-missing')]
        # Exercise every fixed source-owned gate, including nested readiness
        # failures. Text adjacent to an allowed label must never be forwarded.
        for label, code in adapter.DIAGNOSTICS['errors'].items():
            cases.extend([
                (successor.recovery.RecoveryError(label), code),
                (successor.recovery.RecoveryError(label + ':private-token'), 'unclassified-error'),
                (successor.recovery.RecoveryError('private-token:' + label), 'unclassified-error'),
                (RuntimeError(label), 'unclassified-error')])
        for error, expected in cases:
            def failed():
                print('private-token')
                print('private-stderr', file=sys.stderr)
                raise error
            with self.subTest(expected=expected), patch.object(adapter, 'main', side_effect=failed), patch('sys.stdout', new=io.StringIO()) as output, patch('sys.stderr', new=io.StringIO()) as diagnostic:
                self.assertEqual(adapter.entrypoint(), 1)
                self.assertEqual(output.getvalue(), '')
                self.assertEqual(diagnostic.getvalue(), adapter.DIAGNOSTICS['marker'] + expected + '\n')
        with patch.object(adapter, 'main', side_effect=lambda: print('{"fixture":"success"}')), patch('sys.stdout', new=io.StringIO()) as output:
            self.assertEqual(adapter.entrypoint(), 0)
            self.assertEqual(output.getvalue(), '{"fixture":"success"}\n')
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, str(ROOT / 'tests/e2e/public-upgrade-host.py'), 'initialize'],
                env=dict(os.environ, SYSTEM_PUBLIC_UPGRADE_FIXTURE=temporary), capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, adapter.DIAGNOSTICS['marker'] + 'file-missing\n')

    def test_helper_classifies_real_docker_failure_frames_without_exporting_private_context(self):
        adapter = load('native_public_fixture_operation_diagnostics', ROOT / 'tests/e2e/public-upgrade-host.py')

        def docker_failure(*arguments, **options):
            try:
                raise RuntimeError('private-cause /private/credential')
            except RuntimeError as cause:
                raise successor.recovery.RecoveryError('command-failed:docker') from cause

        def update(check_only):
            return adapter.tool.updater.update({}, {}, {}, None, b'', b'', {},
                                               'private-image', 'private-checkpoint', 'private-token',
                                               check_only=check_only)

        cases = [
            (adapter.tool.data_sample, adapter.tool, 'run', 'docker-data-sample-failed'),
            (lambda: adapter.tool.updater.compose({}, 'private-image'), adapter.tool.updater,
             'run', 'docker-compose-up-failed'),
            (lambda: adapter.tool.updater.stop_controller({'Id': 'private-container', 'State': {'Running': True}}),
             adapter.tool.updater, 'run', 'docker-controller-stop-failed'),
            (lambda: adapter.tool.installed({'_root': Path('/private/live'), 'BOOTSTRAPPER_IMAGE': 'example/controller',
                                            'WIZARD_IMAGE': 'example/wizard'}, 'example/system'),
             successor, 'private_input', 'docker-installed-check-failed'),
            (lambda: update(True), adapter.tool.runtime, 'public_manifest_absent', 'docker-update-preflight-failed'),
            (lambda: update(False), adapter.tool.runtime, 'public_manifest_absent', 'docker-command-failed')]
        for call, owner, function, expected in cases:
            def failed():
                print('private-stdout')
                print('private-stderr', file=sys.stderr)
                call()
            with self.subTest(operation=expected), patch.object(owner, function, side_effect=docker_failure), \
                    patch.object(adapter.tool.updater.promoter, 'owned'), \
                    patch.object(successor, 'environment', return_value={}), \
                    patch.object(adapter, 'main', side_effect=failed), \
                    patch('sys.stdout', new=io.StringIO()) as output, \
                    patch('sys.stderr', new=io.StringIO()) as diagnostic:
                self.assertEqual(adapter.entrypoint(), 1)
                self.assertEqual(output.getvalue(), '')
                self.assertEqual(diagnostic.getvalue(), adapter.DIAGNOSTICS['marker'] + expected + '\n')

        # A matching filename/function name is insufficient: only original
        # repository code objects may narrow the generic fixed diagnostic.
        for filename in ('/private/external.py', str(ROOT / 'bootstrapper/upgrade-release.py')):
            scope = {'docker_failure': docker_failure}
            exec(compile('def data_sample():\n    docker_failure()\n', filename, 'exec'), scope)
            with self.subTest(spoofed_frame=filename), patch.object(adapter, 'main', side_effect=scope['data_sample']), \
                    patch('sys.stdout', new=io.StringIO()) as output, \
                    patch('sys.stderr', new=io.StringIO()) as diagnostic:
                self.assertEqual(adapter.entrypoint(), 1)
                self.assertEqual(output.getvalue(), '')
                self.assertEqual(diagnostic.getvalue(), adapter.DIAGNOSTICS['marker'] + 'docker-command-failed\n')

        with patch.object(adapter.tool, 'run', side_effect=RuntimeError('command-failed:docker')):
            try:
                adapter.tool.data_sample()
            except RuntimeError as error:
                self.assertEqual(adapter.diagnostic_code(error), 'unclassified-error')

    def test_native_installer_checks_images_through_the_fixture_registry_transport(self):
        installer = tool.updater.installer
        identity = {'sourceCommit': 'a' * 40, 'wizardSourceRevision': 'b' * 40}
        image_id = 'sha256:' + 'c' * 64
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            shim = directory / 'docker'
            node = shutil.which('node')
            self.assertIsNotNone(node, 'prepared Node runtime required')
            adapter = (ROOT / 'tests/e2e/public-upgrade-docker.js').read_text().split('\n', 1)[1]
            shim.write_text('#!' + node + '\n' + adapter)
            shim.chmod(0o700)
            (directory / 'runtime').mkdir()
            (directory / 'runtime/operations').symlink_to(ROOT / 'operations', target_is_directory=True)
            native = directory / 'docker.native'
            native.write_text('#!' + node + '\n' +
                'const fs=require("node:fs"),path=require("node:path"),root=__dirname;\n' +
                'const expected=["image","inspect","' + image_id + '"];\n' +
                'const args=process.argv.slice(2);\n' +
                'if(JSON.stringify(args)===JSON.stringify(expected))process.exit(0);\n' +
                'if(JSON.stringify(args)!==JSON.stringify(["--host=unix:///var/run/docker.sock",...expected]))process.exit(91);\n' +
                'if(fs.existsSync(path.join(root,"fail-inspection")))process.exit(42);\n' +
                'process.stdout.write(fs.readFileSync(path.join(root,"inspection.json")));\n')
            native.chmod(0o700)
            with patch.dict(os.environ, SYSTEM_PUBLIC_UPGRADE_FIXTURE=temporary), \
                    patch.object(installer, 'DOCKER', [str(shim), '--host=unix:///var/run/docker.sock']):
                for wizard in (False, True):
                    selected = 'docker.io/example/' + ('wizard' if wizard else 'controller') + '@sha256:' + 'd' * 64
                    (directory / 'images.tsv').write_text(selected.removeprefix('docker.io/') + '\t' + image_id + '\ttarget\n')
                    labels = {'org.opencontainers.image.revision': identity['wizardSourceRevision' if wizard else 'sourceCommit'],
                              'org.system-bootstrapper.source-revision': identity['sourceCommit'],
                              'org.system-bootstrapper.test-job': '17'}
                    row = {'Id': image_id, 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': labels}}
                    # JSON layout/transport combinations are covered by the shared
                    # adapter contract; retain the real installer source-label gate here.
                    row['RepoDigests'] = ['system-candidate@' + image_id]
                    (directory / 'inspection.json').write_text(json.dumps([row], indent=2))
                    checked = installer.checked_image(selected, identity, wizard=wizard)
                    self.assertEqual(checked, {'reference': selected, 'imageId': image_id,
                        'candidateJobId': 17, 'platform': 'linux/amd64'})
                    labels['org.opencontainers.image.revision'] = 'e' * 40
                    (directory / 'inspection.json').write_text(json.dumps([row]))
                    with self.assertRaisesRegex(installer.ReleaseError, '^release-image-source-mismatch$'):
                        installer.checked_image(selected, identity, wizard=wizard)
                (directory / 'fail-inspection').touch()
                with self.assertRaisesRegex(installer.ReleaseError, '^command-failed:docker$'):
                    installer.checked_image(selected, identity, wizard=True)

    def test_real_initializer_translates_only_the_prepared_candidate_and_restores_selection(self):
        adapter = load('native_public_fixture_initializer', ROOT / 'tests/e2e/public-upgrade-host.py')
        previous = fixture()[0]
        candidate = 'sha256:' + '5' * 64
        raw = (ROOT / 'system/.docker.env.example').read_bytes() + (
            "\nexport BOOTSTRAPPER_IMAGE='" + candidate + "'\nexport WIZARD_IMAGE='sha256:" + '6' * 64 + "'\n").encode()
        # This is the native failure the test fixture must adapt; production's
        # refusal of a bare current controller ID remains intact.
        with self.assertRaisesRegex(tool.updater.installer.ReleaseError, 'public-dockerhub-digest-required'):
            tool.updater.assignment(raw, previous['images']['controller']['reference'])
        with tempfile.TemporaryDirectory() as temporary:
            live = Path(temporary) / 'live'
            configuration = live / 'configuration'
            configuration.mkdir(parents=True)
            main = configuration / '.docker.env'
            successor.atomic_bytes(main, raw)
            original_profile = b'fixture-original-selection\n'
            successor.atomic_bytes(configuration / '.release-images.env', original_profile)
            inputs = {'live': str(live), 'previous': previous, 'spec': {'images': {'candidate': {'id': candidate}}}}
            successor.atomic_json(Path(temporary) / 'fixture.json', inputs)
            with patch.dict(os.environ, SYSTEM_PUBLIC_UPGRADE_FIXTURE=temporary), patch.object(sys, 'argv', ['host.py', 'initialize']), patch('sys.stdout', new=io.StringIO()) as output:
                adapter.main()
                self.assertTrue(json.loads(output.getvalue())['initialized'])
            initialized = main.read_bytes()
            successor.runtime.cube(initialized)
            self.assertEqual(initialized[:1184], raw[:1184])
            self.assertIn(tool.updater.installer.reference(previous['images']['controller']['reference']).encode(), initialized)
            self.assertIn(tool.updater.installer.reference(previous['images']['wizard']['reference']).encode(), initialized)
            self.assertEqual(json.loads((configuration / '.release-images.json').read_bytes())['images'], previous['images'])
            with patch.dict(os.environ, SYSTEM_PUBLIC_UPGRADE_FIXTURE=temporary), patch.object(sys, 'argv', ['host.py', 'restore-original']), patch('sys.stdout', new=io.StringIO()):
                adapter.main()
            self.assertEqual((configuration / '.release-images.env').read_bytes(), original_profile)
            self.assertFalse((configuration / '.release-images.json').exists())
            for invalid in [raw.replace(candidate.encode(), ('sha256:' + '7' * 64).encode()),
                            raw + ("export BOOTSTRAPPER_IMAGE='" + candidate + "'\n").encode()]:
                successor.atomic_bytes(main, invalid)
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'candidate-controller-'):
                    adapter.previous_configuration(main.read_bytes(), inputs)
                self.assertEqual(main.read_bytes(), invalid)


class Authority(unittest.TestCase):
    def test_containerd_manifest_image_ids_are_bound_separately_from_config_digests(self):
        metadata, proof, security = fixture()
        for role, key, evidence_key in [('controller', 'imageId', 'candidate'), ('wizard', 'wizardImageId', 'wizard')]:
            image = metadata['images'][role]
            image['imageId'] = image['reference'].split('@')[1]
            self.assertNotEqual(image['imageId'], image['configDigest'])
            proof['release'][key] = image['imageId']
            proof['evidence']['images'][evidence_key] = image['imageId']
        proof['release']['candidateEvidenceSha256'] = hashlib.sha256(encoded(proof['evidence'])).hexdigest()
        accepted = authority(metadata, proof, security)
        self.assertEqual(accepted.release['imageId'], metadata['images']['controller']['imageId'])
        self.assertEqual(accepted.release['wizardImageId'], metadata['images']['wizard']['imageId'])
        for invalid in (None, '', 'sha256:invalid', 'SHA256:' + '1' * 64):
            changed, changed_proof = copy.deepcopy((metadata, proof))
            changed['images']['controller']['configDigest'] = invalid
            with self.subTest(configDigest=invalid), self.assertRaisesRegex(
                    successor.recovery.RecoveryError, 'candidate-identity-mismatch'):
                authority(changed, changed_proof, security)
        changed, changed_proof = copy.deepcopy((metadata, proof))
        changed['images']['controller']['imageId'] = 'sha256:' + '1' * 64
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'candidate-identity-mismatch'):
            authority(changed, changed_proof, security)

    def test_public_authority_dispatches_without_private_API_or_credentials(self):
        metadata, proof, security = fixture()
        accepted = authority(metadata, proof, security)
        receipt = successor.verify_pipeline(accepted, accepted.release, accepted.release_bytes, accepted.evidence_bytes)
        self.assertEqual(receipt['authority'], 'public-github-release')
        self.assertEqual(successor.verify_public_pair(accepted, accepted.release, accepted.evidence,
            metadata['images']['controller']['reference'], metadata['images']['wizard']['reference'])['authority'], 'public-github-release')
        self.assertFalse(hasattr(accepted, 'token'))
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'changed'):
            accepted.verify_pipeline(accepted.release, b'changed', accepted.evidence_bytes)

    def test_public_authority_runs_existing_paired_update_and_rollback_without_publisher_API(self):
        native = load('public_upgrade_native_fixture', ROOT / 'tests/bootstrapper/public-controller-update.py')
        case = native.PublicControllerUpdate('runTest')
        case.setUp()
        try:
            metadata = case.accepted_metadata()
            _metadata, proof, _security = fixture()
            metadata.update(version=_metadata['version'], tag=_metadata['tag'])
            historical_source = case.root / 'accepted-source'
            historical_source.mkdir()
            (historical_source / 'VERSION').write_text(metadata['version'])
            case.stack.enter_context(patch.object(native.tool, 'ROOT', historical_source))
            proof['release'] = copy.deepcopy(case.release)
            proof['evidence'] = copy.deepcopy(case.evidence)
            proof['evidence']['results'].append({'name': upgrade_paths.load()['transitions'][0]['requiredStage'], 'status': 'passed'})
            proof['evidence']['evidence']['publicUpgrade'] = fixture()[1]['evidence']['evidence']['publicUpgrade']
            proof['release'].update(registryRepository=case.new.split('@')[0], registryReference=case.new,
                wizardRegistryReference=case.wizard, candidateEvidenceSha256=tool.digest(encoded(proof['evidence'])))
            proof.update(version=metadata['version'], source=metadata['source'], images=metadata['images'], originalEvidenceSha256=metadata['acceptance']['evidenceSha256'])
            accepted = authority(metadata, proof, case.security)
            accepted.base = successor.runtime.origin(case.config, 'GITLAB')
            successor.atomic_json(case.metadata, accepted.metadata)
            baseline = successor.runtime.capture(case.config, ROOT, public=True)
            result = native.tool.update(case.config, accepted.release, accepted.evidence, accepted,
                accepted.release_bytes, accepted.evidence_bytes, case.security, case.new, case.checkpoint,
                '/private/own-installation-token', wizard=case.wizard, release_metadata=case.metadata,
                expected_baseline=baseline)
            self.assertEqual(result['phase'], 'completed')
            self.assertEqual(result['pipeline']['authority'], 'public-github-release')
            result = native.tool.rollback(case.config, case.checkpoint, '/private/own-installation-token')
            self.assertEqual(result['phase'], 'rolled-back')
            self.assertEqual(case.config['_main'].read_bytes(), case.raw)
        finally:
            case.doCleanups()

    def test_rejects_missing_gates_jobs_failed_jobs_cross_attempt_and_changed_images(self):
        changes = [lambda p: p['publication'].update(requiredMergeGate=False),
            lambda p: p['publication']['jobs'].pop(),
            lambda p: p['publication']['jobs'][0].update(status='failed'),
            lambda p: p['publication']['jobs'][0].update(allow_failure=True),
            lambda p: p['publication']['jobs'][0].update(pipelineId=999),
            lambda p: p['publication']['jobs'][0].update(sourceRevision='0' * 40),
            lambda p: p['images']['controller'].update(imageId='sha256:' + '9' * 64),
            lambda p: p['images']['controller'].update(configDigest='sha256:' + '9' * 64),
            lambda p: p['publication']['jobs'].append(p['publication']['jobs'][0])]
        for change in changes:
            metadata, proof, security = fixture()
            proof = copy.deepcopy(proof)
            change(proof)
            with self.subTest(change=change), self.assertRaises(successor.recovery.RecoveryError):
                authority(metadata, proof, security)

    def test_paired_rollback_loads_verified_archives_when_previous_digests_are_absent(self):
        native = load('public_upgrade_archive_fixture', ROOT / 'tests/bootstrapper/public-controller-update.py')
        case = native.PublicControllerUpdate('runTest')
        case.setUp()
        try:
            case.accepted_metadata()
            case.update(wizard=case.wizard, release_metadata=case.metadata)
            record = native.tool.load_operation(case.config, case.checkpoint)[1]
            expected = {'controller': record['previousController'], 'wizard': record['previousWizard']}
            retained = case.root / 'archives'
            (retained / 'images').mkdir(parents=True)
            descriptors, payloads, commands = {}, {}, []
            for index, (role, selected) in enumerate(expected.items()):
                relative = 'images/controller-' + str(index) + '.tar.gz'
                successor.atomic_bytes(retained / relative, ('archived-' + role).encode())
                descriptors[role] = {'file': relative, 'imageId': selected['imageId'],
                    'sha256': successor.recovery.sha(retained / relative)}
                payloads[str(retained / relative)] = copy.deepcopy(case.images.pop(selected['reference']))
                payloads[str(retained / relative)]['RepoDigests'] = []
            def docker(command, **unused):
                commands.append(command)
                action = command[3]
                if action == 'load':
                    row = payloads[command[-1]]
                    case.images[row['Id']] = row
                    return b''
                if action == 'tag':
                    case.images[command[-1]] = copy.deepcopy(case.images[command[-2]])
                    return b''
                if action == 'inspect':
                    row = case.images.get(command[-1])
                    successor.require(row is not None, 'missing-image')
                    return json.dumps([row]).encode()
                raise AssertionError(command)
            def environment(config, reference, **unused):
                return {'BOOTSTRAPPER_IMAGE': reference, 'WIZARD_IMAGE': config['WIZARD_IMAGE']}
            with patch.object(successor.recovery, 'inspect_image', side_effect=inspect_retained_image), \
                    patch.object(successor.recovery, 'run', side_effect=docker), \
                    patch.object(successor, 'environment', side_effect=environment):
                result = native.tool.rollback(case.config, case.checkpoint, '/private/own-token',
                    retained_images=(retained, descriptors))
            self.assertEqual(result['phase'], 'rolled-back')
            expected_raw = case.raw
            for role, key in [('controller', 'BOOTSTRAPPER_IMAGE'), ('wizard', 'WIZARD_IMAGE')]:
                expected_raw = native.tool.assignment(expected_raw, result['recoveredImages'][role]['reference'], key)
            self.assertEqual(case.config['_main'].read_bytes(), expected_raw)
            self.assertEqual((case.checkpoint / 'main-before.env').read_bytes(), case.raw)
            for role, name in [('controller', 'system_bootstrapper_1'), ('wizard', 'system_wizard_1')]:
                self.assertEqual(case.rows[name]['Image'], expected[role]['imageId'])
                self.assertNotIn(expected[role]['reference'], case.images)
            self.assertEqual(sum(command[3] == 'load' for command in commands), 2)
            self.assertFalse(any('pull' in command for command in commands))
            # A subsequent independent verification still proves the aliases;
            # old startup reads these exact saved selectors after a restart.
            with patch.object(successor.recovery, 'inspect_image', side_effect=inspect_retained_image), \
                    patch.object(successor.recovery, 'run', side_effect=docker):
                selected = successor.runtime.public_images(case.config, case.rows)
            self.assertEqual(selected['system_bootstrapper_1']['reference'], result['recoveredImages']['controller']['reference'])
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'archive-recovered-selectors'):
                tool.installed(case.config, 'example/system', '1.2.0')
        finally:
            case.doCleanups()

    def test_retained_archive_mismatch_fails_before_loading_or_creating_aliases(self):
        with tempfile.TemporaryDirectory(prefix='retained-upgrade-') as temporary:
            directory = Path(temporary)
            (directory / 'images').mkdir()
            successor.atomic_bytes(directory / 'images/controller-a.tar.gz', b'changed')
            descriptor = {'controller': {'file': 'images/controller-a.tar.gz', 'sha256': '0' * 64,
                'imageId': 'sha256:' + '1' * 64}}
            expected = {'controller': {'reference': 'example/system@sha256:' + '2' * 64,
                'imageId': 'sha256:' + '1' * 64}}
            with patch.object(successor.recovery, 'run') as docker:
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'archive-changed'):
                    successor.recovery.restore_retained_images(directory, descriptor, expected)
                docker.assert_not_called()

    def test_published_graph_requires_actual_matching_transition_evidence(self):
        for key in ('dataPreserved', 'configurationPreserved', 'runnerRegistryVerified', 'rollbackVerified'):
            metadata, proof, security = fixture()
            proof['evidence']['evidence']['publicUpgrade'][key] = False
            proof['release']['candidateEvidenceSha256'] = hashlib.sha256(encoded(proof['evidence'])).hexdigest()
            with self.subTest(key=key), self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-tested'):
                authority(metadata, proof, security)
        metadata, proof, security = fixture()
        proof['evidence']['results'].pop()
        proof['release']['candidateEvidenceSha256'] = hashlib.sha256(encoded(proof['evidence'])).hexdigest()
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-tested'):
            authority(metadata, proof, security)


class Host(unittest.TestCase):
    @staticmethod
    def publication_fixture():
        metadata, proof, _ = fixture()
        security = json.loads((ROOT / 'gitlab/security-release.json').read_bytes())
        upgrade = proof['evidence']['evidence']['gitlabUpgrade']
        upgrade.update(fromImage=security['fromImage'], toImage=security['toImage'],
            runnerImage=security['runner']['toImage'], runnerVersion=security['runner']['toVersion'],
            helperImage=security['runner']['helperImage'], jobCaBundleSha256=security['jobCaBundleSha256'],
            runnerImageId='sha256:' + '5' * 64, fromRunnerImageId='sha256:' + '6' * 64,
            helperImageId='sha256:' + '7' * 64, fromHelperImageId='sha256:' + '9' * 64,
            securityTrustVerified=True, runnerUpgradeVerified=True, runnerManagerIdentityPreserved=False)
        previous = copy.deepcopy(metadata)
        previous.update(version='1.1.3', tag='v1.1.3')
        source = metadata['source']
        return {'runId': 'f' * 24, 'previous': previous, 'gitlabUpgrade': upgrade,
            'spec': {'sourceRevision': source['revision'], 'sourceTree': source['tree'],
                'wizardSourceRevision': source['wizardRevision'], 'ciIdentity': {'projectId': 4, 'pipelineId': 17, 'candidateJobId': 29},
                'images': {'candidate': {'id': metadata['images']['controller']['imageId'], 'configDigest': 'sha256:' + '2' * 64},
                    'wizard': {'id': metadata['images']['wizard']['imageId'], 'configDigest': 'sha256:' + '3' * 64},
                    'gitlab': {'id': upgrade['toImageId']}, 'runner': {'id': upgrade['runnerImageId']}}}}

    def test_candidate_future_publication_passes_real_authority_with_exact_prepared_identities(self):
        adapter = load('candidate_public_upgrade_host_fixture', ROOT / 'tests/e2e/public-upgrade-host.py')
        value = self.publication_fixture()
        previous, source = value['previous'], value['previous']['source']
        target, raw_proof, security = adapter.publication(value)
        accepted = PublicReleaseAuthority(target, raw_proof, 'https://own-gitlab.example.invalid', security)
        self.assertEqual(accepted.release['sourceRevision'], source['revision'])
        self.assertEqual(accepted.release['candidateJobId'], 29)
        self.assertEqual(accepted.release['imageId'], value['spec']['images']['candidate']['id'])
        self.assertEqual(target['images']['controller']['configDigest'], value['spec']['images']['candidate']['configDigest'])
        self.assertNotEqual(target['images']['controller']['configDigest'], accepted.release['imageId'])
        self.assertEqual(accepted.evidence['evidence']['publicUpgrade']['fromSourceRevision'], previous['source']['revision'])

    def test_native_publication_is_byte_stable_across_fresh_plan_and_apply_processes(self):
        script = '''
import argparse, hashlib, importlib.util, json, sys
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root, operation = Path(sys.argv[2]), sys.argv[3]
spec = importlib.util.spec_from_file_location('native_publication_contract', sys.argv[1])
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)
adapter = contract.load('fresh_native_host', contract.ROOT / 'tests/e2e/public-upgrade-host.py')
fixture = json.loads((root / 'fixture.json').read_bytes())
metadata, proof, security = adapter.publication(fixture)
if operation == 'changed-apply':
    publication = json.loads(proof)
    publication['publication']['jobs'][-1]['id'] += 1
    proof = contract.encoded(publication)
    metadata['publicUpgrade']['sha256'] = hashlib.sha256(proof).hexdigest()
raw = contract.encoded(metadata)
authority = contract.PublicReleaseAuthority(metadata, proof, 'https://own-gitlab.example.invalid', security)
tool, successor = adapter.tool, adapter.successor
selected_checkout = root / 'target-source'
selected_checkout.mkdir(exist_ok=True)
(selected_checkout / 'VERSION').write_text(metadata['version'])
tool.ROOT = selected_checkout
live = root / 'live'
config = {'_root': live, '_main': live / 'configuration/.docker.env', 'SEED_DIR': str(root / 'backup')}
target = live / 'recovery/public-upgrades/test'
args = argparse.Namespace(plan_dir=str(target), repository='example/system', target=metadata['version'],
    backup_file=str(root / 'configuration.zip'), token_file='fixture-token', timeout=60)
with ExitStack() as stack:
    stack.enter_context(patch.object(tool, 'public_inputs', return_value=(raw, proof, authority, security)))
    if operation == 'plan':
        config['_main'].parent.mkdir(parents=True)
        for name in ('.docker.env', '.release-images.json', '.release-images.env'):
            successor.atomic_bytes(config['_main'].parent / name, b'fixture-input')
        stack.enter_context(patch.object(tool, 'installed', return_value=({}, fixture['previous'])))
        for owner, name in ((successor, 'verify_checkout'), (successor, 'sync_idle'),
                            (tool, 'host'), (tool, 'invoke')):
            stack.enter_context(patch.object(owner, name))
        stack.enter_context(patch.object(tool, 'run', return_value=str(root).encode()))
        stack.enter_context(patch.object(tool.shutil, 'disk_usage', return_value=SimpleNamespace(free=1024 ** 4)))
        stack.enter_context(patch.object(tool, 'backup_target', return_value=Path(args.backup_file)))
        stack.enter_context(patch.object(tool.runtime, 'capture', return_value={}))
        stack.enter_context(patch.object(tool, 'data_sample', return_value={'sha256': 'a' * 64}))
        tool.plan(args, config)
        result = 'planned'
    else:
        class AcceptedPublication(Exception): pass
        checked = stack.enter_context(patch.object(tool, 'installed', side_effect=AcceptedPublication))
        args.confirm_plan = tool.digest(successor.private_input(target / 'plan.json'))
        try:
            tool.apply(args, config)
        except AcceptedPublication:
            result = 'accepted-publication-before-installed-checks'
        except successor.recovery.RecoveryError as error:
            assert str(error) == 'public-release-changed-after-plan'
            checked.assert_not_called()
            result = str(error)
print(json.dumps({'metadata': raw.decode(), 'proof': proof.decode(), 'result': result}))
'''
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            successor.atomic_json(root / 'fixture.json', self.publication_fixture())
            outputs = []
            for seed, operation in [('1', 'plan'), ('2', 'apply'), ('12345', 'apply'), ('3', 'changed-apply')]:
                raw = subprocess.check_output([sys.executable, '-c', script, str(Path(__file__).resolve()), temporary, operation],
                    env=dict(os.environ, PYTHONHASHSEED=seed), timeout=30, text=True)
                outputs.append(json.loads(raw))
            for output in outputs[1:3]:
                self.assertEqual(output['metadata'], outputs[0]['metadata'])
                self.assertEqual(output['proof'], outputs[0]['proof'])
                self.assertEqual(output['result'], 'accepted-publication-before-installed-checks')
            self.assertEqual(outputs[0]['result'], 'planned')
            self.assertEqual(outputs[3]['result'], 'public-release-changed-after-plan')
            self.assertNotEqual(outputs[3]['proof'], outputs[0]['proof'])



class Paths(unittest.TestCase):
    def test_known_unknown_unnecessary_unsupported_and_mandatory_intermediates(self):
        graph = upgrade_paths.load()
        self.assertEqual(upgrade_paths.path(graph, 'unknown', '1.2.0')['status'], 'unknown')
        self.assertEqual(upgrade_paths.path(graph, '1.2.0', '1.2.0')['status'], 'unnecessary')
        self.assertEqual(upgrade_paths.path(graph, '1.2.0', '1.1.3')['status'], 'unsupported')
        graph['versions'].append('1.3.0')
        graph['versions'].sort(key=lambda value: tuple(map(int, value.split('.'))))
        graph['transitions'].append(dict(graph['transitions'][0], **{'from': '1.2.0', 'to': '1.3.0',
            'requiredStage': 'public-release-upgrade-1-2-0-to-1-3-0'}))
        self.assertEqual([row['to'] for row in upgrade_paths.path(graph, '1.1.3', '1.3.0')['transitions']], ['1.2.0', '1.3.0'])
        graph['transitions'][0]['databaseMigration'] = True
        with self.assertRaisesRegex(ValueError, 'unimplemented'):
            upgrade_paths.validate(graph)

    def test_offline_Wizard_uses_exact_CLI_metadata(self):
        expected = (ROOT / 'bootstrapper/upgrade-paths.json').read_bytes()
        local = ROOT / 'wizard/src/docs/upgrade-paths.json'
        if local.is_file():
            self.assertEqual(local.read_bytes(), expected)
        else:
            snapshot = json.loads((ROOT / 'project-bootstrap/wizard-source/snapshot.json').read_bytes())
            item = next(file for file in snapshot['files'] if file['path'] == 'src/docs/upgrade-paths.json')
            self.assertEqual(base64.b64decode(item['content']), expected)


class ReleaseProfile(unittest.TestCase):
    def test_different_daemon_store_ID_remains_an_actionable_fail_closed_upgrade(self):
        metadata, _, _ = fixture()
        with tempfile.TemporaryDirectory(prefix='upgrade-image-store-') as temporary:
            root = Path(temporary)
            state = root / 'configuration'
            state.mkdir()
            config = {'_root': root}
            selected = {'productRelease': {'version': metadata['version']},
                **{key: metadata['source'][field] for key, field in
                    [('sourceCommit', 'revision'), ('sourceTree', 'tree'), ('wizardSourceRevision', 'wizardRevision')]},
                'images': {}}
            rows, profile = {}, ''
            for role, key, name in [('controller', 'BOOTSTRAPPER_IMAGE', 'system_bootstrapper_1'),
                                    ('wizard', 'WIZARD_IMAGE', 'system_wizard_1')]:
                image = metadata['images'][role]
                config[key] = image['reference']
                local_id = image['reference'].split('@')[1]
                selected['images'][role] = {'reference': image['reference'], 'imageId': local_id}
                rows[name] = {'Image': local_id}
                profile += key + '=' + tool.updater.installer.reference(image['reference']) + '\n'
            successor.atomic_json(state / '.release-images.json', selected)
            successor.atomic_bytes(state / '.release-images.env', profile.encode())
            with patch.object(tool, 'fetch', return_value=encoded(metadata)), \
                    patch.object(successor, 'verify_source_objects'), \
                    patch.object(tool.runtime, 'inspect_services', return_value=rows), \
                    patch.object(tool.runtime, 'verify_mounts'), patch.object(tool.runtime, 'public_images'), \
                    patch.object(tool.recovery, 'inspect_image') as inspect_image:
                with self.assertRaisesRegex(successor.recovery.RecoveryError,
                        'official-upgrade-requires-recorded-runtime-image-id-see-source-recovery-guide'):
                    tool.installed(config, 'example/system')
                inspect_image.assert_not_called()

    def test_native_fallback_is_literal_private_and_saved_configuration_wins(self):
        with tempfile.TemporaryDirectory(prefix='upgrade-profile-') as temporary:
            root = Path(temporary)
            (root / 'configuration').mkdir()
            main = root / 'configuration/.docker.env'
            main.write_text("SYNC_USER='fixture'\n")
            profile = root / 'configuration/.release-images.env'
            controller, wizard = 'docker.io/example/system@sha256:' + 'a' * 64, 'docker.io/example/wizard@sha256:' + 'b' * 64
            content = ('BOOTSTRAPPER_IMAGE=' + controller + '\nWIZARD_IMAGE=' + wizard + '\n').encode()
            profile.write_bytes(content)
            profile.chmod(0o600)
            selector = root / 'storage.env'
            selector.write_text("PERSISTENCE_MODE=local\nPERSISTENT_MOUNT=/\nPERSISTENT_DIR='" + str(root) + "'\n")
            selector.chmod(0o600)
            import host_service
            entry = str(ROOT / 'tests/bootstrapper/runtime-fixture.cjs')
            host_service._WORKER_ENTRIES = host_service._WORKER_ENTRIES | {entry}
            def settings(method, *args):
                self.assertEqual(method, 'settings')
                outcome = host_service.invoke(entry, {'method': method, 'arguments': args},
                    lambda *_: self.fail('unexpected native command'), successor.recovery.RecoveryError)
                if 'rejected' in outcome: raise successor.recovery.RecoveryError(outcome['rejected'])
                return outcome.get('result')
            # Storage contracts have their own native acceptance; this fixture selects
            # private fallback/configuration bytes through the real runtime service.
            with patch.object(successor.runtime, 'call', side_effect=settings):
                self.assertEqual(successor.runtime.settings(selector)['BOOTSTRAPPER_IMAGE'], controller)
                main.write_text("BOOTSTRAPPER_IMAGE='operator-selection'\n")
                self.assertEqual(successor.runtime.settings(selector)['BOOTSTRAPPER_IMAGE'], 'operator-selection')
                for raw in (content.replace(b'\n', b'\r\n'), content + b'UNKNOWN=unsafe\n', b'BOOTSTRAPPER_IMAGE=$(touch unsafe)\n'):
                    profile.write_bytes(raw)
                    with self.assertRaises(successor.recovery.RecoveryError):
                        successor.runtime.settings(selector)
                profile.write_bytes(content)
                profile.chmod(0o644)
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'private-release-image-selector'):
                    successor.runtime.settings(selector)


class BackupAndApply(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='public-upgrade-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'live/configuration'
        (self.state / '.projects.env').mkdir(parents=True)
        self.main = b'fixture-main-env\n'
        (self.state / '.docker.env').write_bytes(self.main)
        (self.state / '.projects.env/.demo.env').write_bytes(b'fixture-project-env\n')
        self.seed = self.root / 'backup/seed'
        self.seed.mkdir(parents=True)
        self.target = self.root / 'live/recovery/public-upgrades/example'
        self.target.mkdir(parents=True)
        self.config = {'_root': self.root / 'live', '_main': self.state / '.docker.env',
            '_persistence_env': str(self.root / 'storage.env'), 'SEED_DIR': str(self.seed), 'SEED_MOUNT': str(self.seed.parent),
            'BOOTSTRAPPER_IMAGE': 'example/system@sha256:' + 'a' * 64}
        self.plan = {'configurationBackup': str(self.seed.parent / 'configuration.zip'),
                     'configurationSha256': tool.digest(self.main)}
        self.operation = 'a' * 32
        generation = self.seed / 'snapshots/retained'
        generation.mkdir(parents=True)
        manifest = b'{"format":"system-bootstrapper-seed-v2"}'
        (generation / 'manifest.json').write_bytes(manifest)
        seed = {'status': 'completed', 'generation': 'retained', 'manifestSha256': tool.digest(manifest), 'gitlabImageId': 'sha256:' + 'b' * 64}
        association = {'format': 'system-backup-pair-v1', 'verified': True, 'status': 'matched-completed-seed', 'operation': self.operation,
            **{key: seed[key] for key in ('generation', 'manifestSha256', 'gitlabImageId')},
            'configurationFiles': [{'filename': name, 'sha256': tool.digest((self.state / name).read_bytes())}
                for name in ('.docker.env', '.projects.env/.demo.env')]}
        output = self.state / '.coordinated-backups' / self.operation / 'bootstrapper.zip'
        output.parent.mkdir(parents=True)
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('recovery.json', json.dumps({'seed': association}))
            for row in association['configurationFiles']:
                archive.writestr(row['filename'], (self.state / row['filename']).read_bytes())
        output.chmod(0o600)
        self.status = {'id': self.operation, 'state': 'ready', 'helperCompletedAt': '2026-01-01T00:00:00Z',
            'seed': seed, 'configuration': {'status': 'ready', 'sha256': tool.digest(output.read_bytes())}}

    def test_verifies_real_ZIP_Seed_manifest_and_live_configuration_before_accepting_pair(self):
        with patch.object(tool, 'sync_request', return_value=self.status):
            tool.matching_backup(self.config, self.target, self.plan, 60)
        saved = self.target / 'backup.json'
        self.assertTrue(saved.is_file())
        self.assertEqual(json.loads(saved.read_bytes())['seed']['generation'], 'retained')
        self.assertEqual(Path(self.plan['configurationBackup']).stat().st_mode & 0o777, 0o600)

    def test_changed_or_incomplete_backup_is_never_accepted(self):
        (self.state / '.projects.env/.demo.env').write_bytes(b'changed\n')
        with patch.object(tool, 'sync_request', return_value=self.status):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'no-longer-matches'):
                tool.matching_backup(self.config, self.target, self.plan, 60)
        self.assertFalse((self.target / 'backup.json').exists())

    def test_missing_media_fails_native_preflight_before_creating_any_fallback(self):
        path = self.root / 'missing-backup/configuration.zip'
        with patch.object(tool, 'run', side_effect=successor.recovery.RecoveryError('seed-target-unavailable')):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'seed-target-unavailable'):
                tool.backup_target(self.config, path)
        self.assertFalse(path.parent.exists())

    def apply_fixture(self, fail_backup=False, fail_update=False, native_readiness=False):
        metadata, proof, security = fixture()
        accepted = authority(metadata, proof, security)
        target_raw, proof_raw = encoded(metadata), encoded(proof)
        selected = b'{"record":"selected"}\n'
        successor.atomic_bytes(self.state / '.release-images.json', selected)
        successor.atomic_json(self.target / 'baseline.json', {})
        previous = copy.deepcopy(metadata)
        previous['version'] = '1.1.3'
        value = {'format': 'system-public-upgrade-plan-v1', 'transitions': upgrade_paths.load()['transitions'][:1],
            'repository': 'example/system', 'installedVersion': '1.1.3', 'targetVersion': '1.2.0',
            'targetSha256': tool.digest(target_raw), 'provenanceSha256': tool.digest(proof_raw),
            'selectionSha256': tool.digest(selected), 'configurationSha256': tool.digest(self.main),
            'baselineSha256': tool.digest(successor.private_input(self.target / 'baseline.json')),
            'dataSample': {'sha256': 'a' * 64}, 'checkpoint': str(self.root / 'live/recovery/controller-updates/example'),
            'configurationBackup': str(self.seed.parent / 'configuration.zip')}
        successor.atomic_json(self.target / 'plan.json', value)
        args = argparse.Namespace(plan_dir=str(self.target), confirm_plan=tool.digest(successor.private_input(self.target / 'plan.json')),
            token_file='own-installation-token', timeout=60, backup_timeout=60)
        events = []
        def image_archive(directory, reference, image, source):
            events.append('archive')
            return {'file': 'images/controller-fixture.tar.gz', 'sha256': 'a' * 64, 'imageId': image}
        def backup(*unused):
            self.assertEqual(events, ['preflight', 'archive', 'archive'])
            events.append('matching-backup')
            if fail_backup:
                raise successor.recovery.RecoveryError('backup-failed')
            successor.atomic_json(self.target / 'backup.json', {'operation': self.operation})
        def ready(*values):
            self.assertEqual(events[-1], 'matching-backup')
            self.assertEqual(values, (self.config, {}, args.token_file, None, args.timeout))
            events.append('post-backup-ready')
            return {'runnerManagers': {'checked': True}, 'format': 'fixture-verification'}
        def invoke(*values):
            if values[-1] is True:
                events.append('preflight')
            else:
                self.assertEqual(events[-1], 'post-backup-ready')
                self.assertEqual(values[-1], {})
                events.append('native-update')
                if fail_update:
                    raise successor.recovery.RecoveryError('update-failed')
        stack = ExitStack()
        stack.enter_context(patch.object(tool, 'public_inputs', return_value=(target_raw, proof_raw, accepted, security)))
        stack.enter_context(patch.object(tool, 'installed', return_value=({}, previous)))
        stack.enter_context(patch.object(tool.runtime, 'assert_baseline'))
        stack.enter_context(patch.object(tool, 'host'))
        stack.enter_context(patch.object(tool, 'data_sample', return_value=value['dataSample']))
        stack.enter_context(patch.object(tool, 'backup_target'))
        stack.enter_context(patch.object(tool, 'invoke', side_effect=invoke))
        native_operation = tool.recovery.host_operation
        def operation(name, *arguments):
            if name == 'saveRecoveryArchive':
                return image_archive(*arguments)
            return native_operation(name, *arguments)
        stack.enter_context(patch.object(tool.recovery, 'host_operation', side_effect=operation))
        stack.enter_context(patch.object(tool, 'matching_backup', side_effect=backup))
        if not native_readiness:
            stack.enter_context(patch.object(tool.updater, 'wait_ready', side_effect=ready))
        self.addCleanup(stack.close)
        return args, events

    def test_approved_apply_retains_independent_payloads_before_cold_backup_then_native_update(self):
        args, events = self.apply_fixture()
        result = tool.apply(args, self.config)
        self.assertEqual(events, ['preflight', 'archive', 'archive', 'matching-backup', 'post-backup-ready', 'native-update'])
        self.assertEqual(result['phase'], 'completed')
        self.assertTrue(result['dataSampleVerified'])
        self.assertEqual(result['sourceRevision'], 'a' * 40)
        self.assertEqual(json.loads(successor.private_input(self.target / 'post-backup-verification.json'))['format'],
                         'fixture-verification')

    def readiness_transport(self, events, healthy_after):
        self.config.update(WIZARD_ENABLE='true', GITLAB_RUNNER_SCALE='1')
        clock, inspections = [0], []
        def docker(arguments, **unused):
            self.assertEqual(arguments, [*successor.runtime.DOCKER, 'inspect', 'system_bootstrapper_1',
                'system_web_1', 'system_gitlab_1', 'system_wizard_1', 'runner_docker_1'])
            inspections.append(clock[0])
            return json.dumps([{'Name': '/' + name, 'State': {'Running': True, 'OOMKilled': False,
                'Health': {'Status': 'healthy' if len(inspections) >= healthy_after else 'starting'}}}
                for name in arguments[3:]]).encode()
        def verify(config, baseline, checkout, token_file, redirect_from, public=False):
            self.assertEqual(events[-1], 'matching-backup')
            self.assertEqual((config, baseline, checkout, token_file, redirect_from, public),
                (self.config, {}, tool.ROOT, 'own-installation-token', None, True))
            self.assertEqual(json.loads(successor.private_input(self.target / 'operation.json'))['phase'],
                             'backup-services-resuming')
            tool.runtime.assert_baseline(config, baseline)
            # Exercise the production Docker health boundary rather than making
            # the readiness loop's verifier return a synthetic health failure.
            tool.runtime.inspect_services(config)
            events.append('post-backup-ready')
            return {'runnerManagers': {'checked': True}, 'checkedAt': clock[0]}
        stack = ExitStack()
        native_clock = SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        stack.enter_context(patch.object(tool.updater, 'time', native_clock))
        stack.enter_context(patch.object(successor.recovery, 'time', native_clock))
        def inspect(config):
            rows = json.loads(docker([*successor.runtime.DOCKER, 'inspect', 'system_bootstrapper_1',
                'system_web_1', 'system_gitlab_1', 'system_wizard_1', 'runner_docker_1']))
            return successor.recovery.host_operation('inspectServiceRows', config, rows, None)
        stack.enter_context(patch.object(tool.runtime, 'inspect_services', side_effect=inspect))
        stack.enter_context(patch.object(tool.runtime, 'verify', side_effect=verify))
        self.addCleanup(stack.close)
        return clock, inspections

    def test_apply_waits_for_real_Docker_health_after_backup_before_sampling_or_updating(self):
        args, events = self.apply_fixture(native_readiness=True)
        clock, inspections = self.readiness_transport(events, healthy_after=3)
        sample = tool.data_sample
        def sampled():
            if 'matching-backup' in events:
                self.assertIn('post-backup-ready', events)
            return sample()
        with patch.object(tool, 'data_sample', side_effect=sampled):
            result = tool.apply(args, self.config)
        self.assertEqual(inspections, [0, 3, 6])
        self.assertEqual(clock[0], 6)
        self.assertEqual(events[-2:], ['post-backup-ready', 'native-update'])
        self.assertEqual(result['phase'], 'completed')
        self.assertEqual(json.loads(successor.private_input(self.target / 'post-backup-verification.json'))['checkedAt'], 6)
        self.assertIsNone(successor.recovery.OPERATION_DEADLINE)

    def test_post_backup_health_timeout_retains_backup_without_starting_native_update(self):
        args, events = self.apply_fixture(native_readiness=True)
        args.timeout = 6
        clock, inspections = self.readiness_transport(events, healthy_after=100)
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'controller-update-readiness-failed:service-not-healthy'):
            tool.apply(args, self.config)
        self.assertEqual((clock[0], inspections), (6, [0, 3]))
        self.assertNotIn('native-update', events)
        self.assertEqual(tool.data_sample.call_count, 1)
        self.assertEqual(json.loads(successor.private_input(self.target / 'operation.json'))['phase'], 'needs-inspection')
        self.assertTrue((self.target / 'previous-images.json').is_file())
        self.assertTrue((self.target / 'backup.json').is_file())
        self.assertFalse((self.target / 'post-backup-verification.json').exists())
        self.assertFalse((self.config['_root'] / 'recovery/controller-updates/example').exists())
        self.assertIsNone(successor.recovery.OPERATION_DEADLINE)

    def test_post_backup_readiness_honors_an_earlier_native_operation_deadline(self):
        args, events = self.apply_fixture(native_readiness=True)
        clock, inspections = self.readiness_transport(events, healthy_after=100)
        with patch.object(successor.recovery, 'OPERATION_DEADLINE', 4):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'controller-update-readiness-failed:service-not-healthy'):
                tool.apply(args, self.config)
            self.assertEqual(successor.recovery.OPERATION_DEADLINE, 4)
        self.assertEqual((clock[0], inspections), (4, [0, 3]))
        self.assertNotIn('native-update', events)

    def test_backup_failure_never_starts_updater_and_retains_inspectable_operation(self):
        args, events = self.apply_fixture(fail_backup=True)
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'backup-failed'):
            tool.apply(args, self.config)
        self.assertNotIn('native-update', events)
        self.assertEqual(json.loads(successor.private_input(self.target / 'operation.json'))['phase'], 'needs-inspection')
        self.assertTrue((self.target / 'previous-images.json').is_file())

    def test_update_failure_keeps_recovery_inputs_and_never_claims_completion(self):
        args, events = self.apply_fixture(fail_update=True)
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'update-failed'):
            tool.apply(args, self.config)
        self.assertEqual(events[-1], 'native-update')
        self.assertEqual(json.loads(successor.private_input(self.target / 'operation.json'))['phase'], 'needs-inspection')

    def test_same_plan_coordinators_fail_before_backup_or_update(self):
        import fcntl
        descriptor = os.open(self.target / '.coordinator.lock', os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(tool, 'apply_locked') as update:
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'coordinator-is-running'):
                    tool.apply(argparse.Namespace(plan_dir=str(self.target)), self.config)
                update.assert_not_called()
        finally:
            os.close(descriptor)

    def test_concurrent_plan_cannot_interrupt_or_replace_active_attempt(self):
        active = {'format': 'system-public-upgrade-preflight-v1', 'phase': 'checking', 'attemptId': 'a' * 32}
        successor.atomic_json(self.target / 'preflight.json', active)
        lock = self.config['_main'].parent / '.public-upgrade-plan.lock'
        code = 'import fcntl,os,sys; fd=os.open(sys.argv[1],os.O_RDWR|os.O_CREAT,0o600); fcntl.flock(fd,fcntl.LOCK_EX); print("locked",flush=True); sys.stdin.read(1)'
        child = subprocess.Popen([sys.executable, '-c', code, str(lock)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'locked')
            with patch.object(tool, 'plan_locked') as native:
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'coordinator-is-running'):
                    tool.plan(argparse.Namespace(plan_dir=str(self.target)), self.config)
                native.assert_not_called()
            self.assertEqual(json.loads((self.target / 'preflight.json').read_bytes()), active)
        finally:
            child.stdin.close()
            child.wait(timeout=5)
            child.stdout.close()
        with patch.object(tool, 'plan_locked', return_value=('planned', 'digest')) as native:
            self.assertEqual(tool.plan(argparse.Namespace(plan_dir=str(self.target)), self.config), ('planned', 'digest'))
            native.assert_called_once()

    def test_apply_requires_exact_explicit_plan_before_any_external_calls(self):
        successor.atomic_json(self.target / 'plan.json', {'format': 'system-public-upgrade-plan-v1'})
        args = argparse.Namespace(plan_dir=str(self.target), confirm_plan='0' * 64)
        with patch.object(tool, 'public_inputs') as remote:
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'explicit-matching-plan'):
                tool.apply(args, self.config)
            remote.assert_not_called()
        self.assertFalse((self.target / 'operation.json').exists())


if __name__ == '__main__':
    unittest.main()
