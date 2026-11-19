#!/usr/bin/env python3
"""Public provenance authority, exact graph, backup pairing and fail-closed plans."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
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
    names = list(successor.REQUIRED_JOBS) + ['test:wizard-browser', 'test:codeql', 'deploy:dockerhub', 'deploy:github']
    names += ['test:isolated: [' + component + ']' for component in successor.COMPONENTS]
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
            proof['release'] = copy.deepcopy(case.release)
            proof['evidence'] = copy.deepcopy(case.evidence)
            proof['evidence']['results'].append({'name': upgrade_paths.load()['transitions'][0]['requiredStage'], 'status': 'passed'})
            proof['evidence']['evidence']['publicUpgrade'] = fixture()[1]['evidence']['evidence']['publicUpgrade']
            proof['release'].update(registryRepository=case.new.split('@')[0], registryReference=case.new,
                wizardRegistryReference=case.wizard, candidateEvidenceSha256=tool.digest(encoded(proof['evidence'])))
            proof.update(source=metadata['source'], images=metadata['images'], originalEvidenceSha256=metadata['acceptance']['evidenceSha256'])
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
    def test_candidate_future_publication_passes_real_authority_with_exact_prepared_identities(self):
        adapter = load('candidate_public_upgrade_host_fixture', ROOT / 'tests/e2e/public-upgrade-host.py')
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
        value = {'runId': 'f' * 24, 'previous': previous, 'gitlabUpgrade': upgrade,
            'spec': {'sourceRevision': source['revision'], 'sourceTree': source['tree'],
                'wizardSourceRevision': source['wizardRevision'], 'ciIdentity': {'projectId': 4, 'pipelineId': 17, 'candidateJobId': 29},
                'images': {'candidate': {'id': metadata['images']['controller']['imageId'], 'configDigest': 'sha256:' + '2' * 64},
                    'wizard': {'id': metadata['images']['wizard']['imageId'], 'configDigest': 'sha256:' + '3' * 64},
                    'gitlab': {'id': upgrade['toImageId']}, 'runner': {'id': upgrade['runnerImageId']}}}}
        target, raw_proof, _ = adapter.publication(value)
        accepted = PublicReleaseAuthority(target, raw_proof, 'https://own-gitlab.example.invalid', security)
        self.assertEqual(accepted.release['sourceRevision'], source['revision'])
        self.assertEqual(accepted.release['candidateJobId'], 29)
        self.assertEqual(accepted.release['imageId'], value['spec']['images']['candidate']['id'])
        self.assertEqual(target['images']['controller']['configDigest'], value['spec']['images']['candidate']['configDigest'])
        self.assertNotEqual(target['images']['controller']['configDigest'], accepted.release['imageId'])
        self.assertEqual(accepted.evidence['evidence']['publicUpgrade']['fromSourceRevision'], previous['source']['revision'])

    def test_nominal_8GiB_host_tolerates_kernel_reservation(self):
        metadata = {'platform': 'linux/amd64', 'compatibility': {'versions': ['24.04'], 'minimumMemoryGiB': 8}}
        with patch.object(tool.platform, 'freedesktop_os_release', return_value={'ID': 'ubuntu', 'VERSION_ID': '24.04'}), \
                patch.object(tool.platform, 'machine', return_value='x86_64'), \
                patch.object(tool.Path, 'read_text', return_value='MemTotal: 7864320 kB\n'):
            tool.host(metadata)
        with patch.object(tool.platform, 'freedesktop_os_release', return_value={'ID': 'ubuntu', 'VERSION_ID': '24.04'}), \
                patch.object(tool.platform, 'machine', return_value='x86_64'), \
                patch.object(tool.Path, 'read_text', return_value='MemTotal: 7800000 kB\n'):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'insufficient-upgrade-memory'):
                tool.host(metadata)


class Paths(unittest.TestCase):
    def test_known_unknown_unnecessary_unsupported_and_mandatory_intermediates(self):
        graph = upgrade_paths.load()
        self.assertEqual(upgrade_paths.path(graph, 'unknown', '1.2.0')['status'], 'unknown')
        self.assertEqual(upgrade_paths.path(graph, '1.2.0', '1.2.0')['status'], 'unnecessary')
        self.assertEqual(upgrade_paths.path(graph, '1.2.0', '1.1.3')['status'], 'unsupported')
        graph['versions'].append('1.3.0')
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
            execute = subprocess.run
            def checked(arguments, **kwargs):
                if arguments[:2] == ['bash', str(ROOT / 'bootstrapper/persistence.sh')]:
                    return subprocess.CompletedProcess(arguments, 0)
                return execute(arguments, **kwargs)
            with patch.object(successor.runtime.subprocess, 'run', side_effect=checked):
                self.assertEqual(successor.runtime.settings(selector)['BOOTSTRAPPER_IMAGE'], controller)
                main.write_text("BOOTSTRAPPER_IMAGE='operator-selection'\n")
                self.assertEqual(successor.runtime.settings(selector)['BOOTSTRAPPER_IMAGE'], 'operator-selection')
                for raw in (content.replace(b'\n', b'\r\n'), content + b'UNKNOWN=unsafe\n', b'BOOTSTRAPPER_IMAGE=$(touch unsafe)\n'):
                    profile.write_bytes(raw)
                    with self.assertRaises(successor.recovery.RecoveryError):
                        successor.runtime.settings(selector)
                profile.write_bytes(content)
                profile.chmod(0o644)
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'private-release-profile'):
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

    def apply_fixture(self, fail_backup=False, fail_update=False):
        metadata, proof, security = fixture()
        accepted = authority(metadata, proof, security)
        target_raw, proof_raw = encoded(metadata), encoded(proof)
        selected = b'{"record":"selected"}\n'
        successor.atomic_bytes(self.state / '.release-images.json', selected)
        successor.atomic_json(self.target / 'baseline.json', {})
        previous = copy.deepcopy(metadata)
        previous['version'] = '1.1.3'
        value = {'format': 'system-public-upgrade-plan-v1', 'transitions': upgrade_paths.load()['transitions'],
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
        def invoke(*values):
            if values[-1] is True:
                events.append('preflight')
            else:
                self.assertEqual(events[-1], 'matching-backup')
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
        stack.enter_context(patch.object(tool.archives, 'save_archive', side_effect=image_archive))
        stack.enter_context(patch.object(tool, 'matching_backup', side_effect=backup))
        self.addCleanup(stack.close)
        return args, events

    def test_approved_apply_retains_independent_payloads_before_cold_backup_then_native_update(self):
        args, events = self.apply_fixture()
        result = tool.apply(args, self.config)
        self.assertEqual(events, ['preflight', 'archive', 'archive', 'matching-backup', 'native-update'])
        self.assertEqual(result['phase'], 'completed')
        self.assertTrue(result['dataSampleVerified'])
        self.assertEqual(result['sourceRevision'], 'a' * 40)

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
