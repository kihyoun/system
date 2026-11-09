#!/usr/bin/env python3
"""Offline public-image identity and controller-only update/rollback failures."""
import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bootstrapper'))
import successor


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


tool = load('public_controller_update', ROOT / 'bootstrapper/update-controller.py')
fixtures = load('successor_fixtures', ROOT / 'tests/bootstrapper/successor-host-tools.py')
runtime, recovery = successor.runtime, successor.recovery


class PublicControllerUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='public-controller-update-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ['configuration/.projects.env', 'host/letsencrypt', 'gitlab/data',
                     'runners/runner/1/config', 'runners/runner/2/config']:
            (self.root / name).mkdir(parents=True)
        for index in (1, 2):
            (self.root / f'runners/runner/{index}/config/.runner_system_id').write_text(f's_manager{index}\n')
        self.release, self.evidence, self.security = fixtures.fixture()
        self.security.update(toVersion='new')
        self.api = fixtures.API(self.release, self.evidence)
        self.evidence['evidence']['gitlabUpgrade']['runnerImageId'] = 'sha256:' + '5' * 64
        self.api.evidence = copy.deepcopy(self.evidence)
        self.api.release['candidateEvidenceSha256'] = self.release['candidateEvidenceSha256'] = hashlib.sha256(
            json.dumps(self.evidence).encode()).hexdigest()
        self.old = 'docker.io/example/system@sha256:' + '0' * 64
        self.new = 'docker.io/example/system@sha256:' + '1' * 64
        self.config = {'_root': self.root, '_main': self.root / 'configuration/.docker.env',
                       '_persistence_env': str(self.root / 'persistence.env'),
                       'BOOTSTRAPPER_IMAGE': self.old, 'NGINX_IMAGE': 'nginx',
                       'GITLAB_IMAGE': self.security['toImage'], 'GITLAB_RUNNER_IMAGE': 'runner:current',
                       'WIZARD_IMAGE': 'registry.example.invalid:5443/wizard@sha256:' + '6' * 64,
                       'GITLAB_RUNNER_SCALE': '2', 'WIZARD_ENABLE': 'true', 'SYNC_ENABLE': 'true',
                       'SYNC_USER': 'fixture', 'SYNC_PASS': 'synthetic',
                       'PERSISTENCE_MODE': 'local', 'PERSISTENT_MOUNT': '/', 'PERSISTENT_UUID': '',
                       'SEED_DIR': '', 'SEED_MOUNT': '', 'SEED_UUID': ''}
        for service in ('WIZARD', 'SYNC', 'GITLAB', 'GITLAB_REGISTRY'):
            self.config[service + '_DOMAIN_MODE'] = '0'
            self.config[service + '_HOST'] = service.lower() + '.example.invalid'
        self.api.base = runtime.origin(self.config, 'GITLAB')
        self.raw = (ROOT / 'system/.docker.env.example').read_bytes()[:1184] + b'\n'
        self.raw += ''.join('export ' + key + "='" + value + "'\n" for key, value in self.config.items()
                            if not key.startswith('_')).encode()
        successor.atomic_bytes(self.config['_main'], self.raw)
        successor.atomic_bytes(self.root / 'configuration/sync-auth.env', b'export SYNC_USER=fixture\n')
        self.images = {
            self.old: {'Id': 'sha256:' + '0' * 64, 'RepoDigests': [self.old.removeprefix('docker.io/')],
                       'Config': {'Labels': {'org.opencontainers.image.revision': 'f' * 40}}},
            self.new: {'Id': self.release['imageId'], 'RepoDigests': [self.new.removeprefix('docker.io/')],
                       'Config': {'Labels': {'org.opencontainers.image.revision': self.release['sourceRevision']}}},
            'nginx': {'Id': 'sha256:' + '7' * 64, 'RepoDigests': []},
            self.config['GITLAB_IMAGE']: {'Id': self.evidence['images']['gitlab'],
                                        'RepoDigests': [self.config['GITLAB_IMAGE']]},
            self.config['GITLAB_RUNNER_IMAGE']: {'Id': 'sha256:' + '5' * 64, 'RepoDigests': []},
            self.config['WIZARD_IMAGE']: {'Id': 'sha256:' + '6' * 64, 'RepoDigests': [self.config['WIZARD_IMAGE']]}}
        self.rows = {}
        for name, key in [('system_bootstrapper_1', 'BOOTSTRAPPER_IMAGE'), ('system_web_1', 'NGINX_IMAGE'),
                          ('system_gitlab_1', 'GITLAB_IMAGE'), ('system_wizard_1', 'WIZARD_IMAGE'),
                          ('runner_docker_1', 'GITLAB_RUNNER_IMAGE'), ('runner_docker_2', 'GITLAB_RUNNER_IMAGE')]:
            service = name.split('_')[1]
            self.rows[name] = {'Id': name + '-old', 'Image': self.images[self.config[key]]['Id'],
                               'State': {'Running': True, 'StartedAt': 'original'},
                               'Config': {'Labels': {'com.docker.compose.project': 'system',
                                                     'com.docker.compose.service': service}},
                               'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped'}}}
        self.commands = []
        self.compose_fail = False
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(successor, 'verify_checkout'))
        self.stack.enter_context(patch.object(successor, 'sync_idle'))
        self.stack.enter_context(patch.object(successor, 'environment', return_value={}))
        self.stack.enter_context(patch.object(recovery, 'inspect_image', side_effect=lambda ref: self.images[ref]))
        self.stack.enter_context(patch.object(runtime, 'inspect_services', side_effect=lambda config: copy.deepcopy(self.rows)))
        self.stack.enter_context(patch.object(runtime, 'verify_mounts', return_value=20))
        self.routes = self.stack.enter_context(patch.object(runtime, 'verify_routes'))
        self.stack.enter_context(patch.object(runtime, 'verify_sync'))
        self.contacts = self.stack.enter_context(patch.object(runtime, 'runner_contacts',
                                                             return_value={'checked': True, 'online': 2}))
        self.stack.enter_context(patch.object(runtime, 'run', side_effect=self.git))
        self.stack.enter_context(patch.object(runtime, 'settings', side_effect=self.settings))
        self.stack.enter_context(patch.object(tool.promoter, 'inspect', side_effect=self.inspect))
        self.probe = self.stack.enter_context(patch.object(tool.promoter, 'gitlab_preflight'))
        self.stack.enter_context(patch.object(tool, 'run', side_effect=self.command))
        self.pulled = {'reference': self.new, 'imageId': self.release['imageId'],
                       'candidateJobId': self.release['candidateJobId']}
        self.checked = self.stack.enter_context(patch.object(tool.installer, 'checked_image', side_effect=lambda *a, **k: self.pulled))
        self.checkpoint = self.root / 'recovery/controller-updates/attempt'
        self.controller_template = copy.deepcopy(self.rows['system_bootstrapper_1'])

    def git(self, command, **kwargs):
        if command[-2:] == ['status', '--porcelain']: return b''
        if command[-1] == 'HEAD': return self.release['sourceRevision'].encode()
        if command[-1].endswith('^{tree}'): return ('b' * 40).encode()
        raise AssertionError(command)

    def settings(self, unused):
        for key in ['BOOTSTRAPPER_IMAGE', 'WIZARD_IMAGE']:
            selected = self.config['_main'].read_text().split('export ' + key + '=', 1)[1].splitlines()[0].strip("'")
            self.config[key] = selected
        return self.config

    def inspect(self, name):
        for key, row in self.rows.items():
            if key == name or row['Id'] == name: return copy.deepcopy(row)
        raise recovery.RecoveryError('missing-container')

    def command(self, command, **kwargs):
        self.commands.append(command)
        if command[2:4] == ['container', 'ls']:
            name = 'system_wizard_1' if 'name=^/system_wizard_1$' in command else 'system_bootstrapper_1'
            return (name + '\n').encode() if name in self.rows else b''
        if 'stop' in command:
            self.rows['system_bootstrapper_1']['State']['Running'] = False
        if 'compose' in command:
            if self.compose_fail: raise recovery.RecoveryError('synthetic-compose-failure')
            self.settings(None)
            row = self.rows.setdefault('system_bootstrapper_1', copy.deepcopy(self.controller_template))
            row.update(Id='controller-replaced', Image=self.images[self.config['BOOTSTRAPPER_IMAGE']]['Id'])
            row['State'] = {'Running': True, 'StartedAt': 'replacement'}
            if getattr(self, 'paired', False):
                row = self.rows.setdefault('system_wizard_1', copy.deepcopy(self.wizard_template))
                row.update(Id='wizard-replaced', Image=self.images[self.config['WIZARD_IMAGE']]['Id'])
                row['State'] = {'Running': True, 'StartedAt': 'replacement'}
        return b''

    def update(self, **extra):
        return tool.update(self.config, self.release, self.evidence, self.api,
                           json.dumps(self.release).encode(), json.dumps(self.evidence).encode(), self.security,
                           self.new, self.checkpoint, '/private/synthetic-token', **extra)

    def enable_pair(self):
        old_new = self.new
        self.new, self.wizard, self.public, self.source = fixtures.public_pair(self.release, self.evidence, self.api)
        self.images[self.new] = self.images.pop(old_new)
        self.images[self.new]['RepoDigests'] = [self.new]
        self.pulled['reference'] = self.new
        self.images[self.wizard] = {'Id': self.release['wizardImageId'], 'RepoDigests': [self.wizard]}
        self.pulled_wizard = {'reference': self.wizard, 'imageId': self.release['wizardImageId'],
                              'candidateJobId': self.release['candidateJobId']}
        self.checked.side_effect = lambda *args, **kwargs: self.pulled_wizard if kwargs.get('wizard') else self.pulled
        self.wizard_template = copy.deepcopy(self.rows['system_wizard_1'])
        self.paired = True

    def accepted_metadata(self, existing=True):
        self.enable_pair()
        value = {'format': 'system-accepted-release-v1', 'version': (ROOT / 'VERSION').read_text().strip(),
                 'tag': 'v' + (ROOT / 'VERSION').read_text().strip(), 'platform': 'linux/amd64',
                 'source': {'revision': self.release['sourceRevision'], 'tree': self.release['sourceTree'],
                            'wizardRevision': self.release['wizardRevision']},
                 'images': {role: {'reference': row['reference'], 'imageId': row['imageId'],
                                  'configDigest': row['imageId']}
                            for role, row in [('controller', self.pulled), ('wizard', self.pulled_wizard)]},
                 'acceptance': {'candidateJobId': self.release['candidateJobId'],
                                'evidenceSha256': self.release['candidateEvidenceSha256'],
                                'controllerWizardSameAttempt': True, 'requiredChecksPassed': True}}
        self.metadata = self.root / 'accepted-public.json'
        self.metadata.write_text(json.dumps(value))
        if existing:
            successor.atomic_bytes(self.config['_main'].parent / '.release-images.json', b'{"original":true}\n')
            successor.atomic_bytes(self.config['_main'].parent / '.release-images.env',
                                   ('BOOTSTRAPPER_IMAGE=' + self.old + '\nWIZARD_IMAGE=' +
                                    self.config['WIZARD_IMAGE'] + '\n').encode())
        return value

    def test_metadata_refresh_is_checkpointed_and_restores_exact_prior_selection(self):
        accepted = self.accepted_metadata()
        before, payloads = tool.release_selection(self.config)
        record = self.update(wizard=self.wizard, release_metadata=self.metadata)
        receipt = json.loads((self.config['_main'].parent / '.release-images.json').read_bytes())
        self.assertEqual(receipt['productRelease'], {'version': accepted['version'], 'tag': accepted['tag'],
                                                    'sourceRevision': self.release['sourceRevision']})
        self.assertEqual(receipt['sourceTree'], self.release['sourceTree'])
        self.assertEqual(receipt['wizardSourceRevision'], self.release['wizardRevision'])
        self.assertEqual(receipt['images'], {'controller': self.pulled, 'wizard': self.pulled_wizard})
        self.assertEqual(receipt['status'], 'selected')
        self.assertEqual((self.config['_main'].parent / '.release-images.env').read_text(),
                         'BOOTSTRAPPER_IMAGE=' + self.new + '\nWIZARD_IMAGE=' + self.wizard + '\n')
        self.assertEqual(record['releaseSelection']['before'], before)
        self.assertEqual(json.loads((self.checkpoint / 'accepted-public-release.json').read_bytes()), accepted)
        for name, payload in payloads.items():
            self.assertEqual((self.checkpoint / (name + '.before')).read_bytes(), payload)
        tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(tool.release_selection(self.config), (before, payloads))

    def test_metadata_preflight_checks_without_writes_and_refuses_other_attempt(self):
        accepted = self.accepted_metadata()
        before = tool.release_selection(self.config)
        self.update(wizard=self.wizard, release_metadata=self.metadata, check_only=True)
        self.assertEqual(tool.release_selection(self.config), before)
        for category in ('source', 'image', 'candidate', 'evidence', 'version'):
            changed = copy.deepcopy(accepted)
            if category == 'source': changed['source']['wizardRevision'] = '0' * 40
            elif category == 'image': changed['images']['wizard']['imageId'] = 'sha256:' + '0' * 64
            elif category == 'candidate': changed['acceptance']['candidateJobId'] += 1
            elif category == 'evidence': changed['acceptance']['evidenceSha256'] = '0' * 64
            else: changed.update(version='99.0.0', tag='v99.0.0')
            self.metadata.write_text(json.dumps(changed))
            with self.subTest(category=category), self.assertRaises((recovery.RecoveryError, tool.installer.ReleaseError)):
                self.update(wizard=self.wizard, release_metadata=self.metadata)
        self.assertFalse(self.checkpoint.exists())
        self.assertEqual(self.commands, [])
        self.assertEqual(tool.release_selection(self.config), before)

    def test_partial_metadata_update_restores_known_old_and_new_receipt_files(self):
        self.accepted_metadata()
        before = tool.release_selection(self.config)
        atomic = successor.atomic_bytes
        def fail_second_selection(path, payload, *args):
            if Path(path) == self.config['_main'].parent / '.release-images.env':
                raise recovery.RecoveryError('synthetic-selection-write-failure')
            return atomic(path, payload, *args)
        with patch.object(successor, 'atomic_bytes', side_effect=fail_second_selection):
            with self.assertRaisesRegex(recovery.RecoveryError, 'selection-write-failure'):
                self.update(wizard=self.wizard, release_metadata=self.metadata)
        mixed, _ = tool.release_selection(self.config)
        self.assertNotEqual(mixed['.release-images.json'], before[0]['.release-images.json'])
        self.assertEqual(mixed['.release-images.env'], before[0]['.release-images.env'])
        self.assertTrue((self.root / 'configuration/.storage-operation-lock').exists())
        with patch.object(successor, 'process_start', return_value='different-process'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(tool.release_selection(self.config), before)

    def test_interrupted_selection_replacement_preserves_nonroot_owner_atomically(self):
        self.accepted_metadata()
        for name in tool.RELEASE_SELECTION:
            os.chown(self.config['_main'].parent / name, 65534, 65534)
        before = tool.release_selection(self.config)
        replace = os.replace
        target = self.config['_main'].parent / '.release-images.json'
        def interrupted(source, destination):
            result = replace(source, destination)
            if Path(destination) == target:
                self.assertEqual((target.stat().st_uid, target.stat().st_gid), (65534, 65534))
                raise recovery.RecoveryError('synthetic-loss-after-selection-rename')
            return result
        with patch.object(os, 'replace', interrupted):
            with self.assertRaisesRegex(recovery.RecoveryError, 'loss-after-selection-rename'):
                self.update(wizard=self.wizard, release_metadata=self.metadata)
        with patch.object(successor, 'process_start', return_value='different-process'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(tool.release_selection(self.config), before)

    def test_selection_owner_failure_does_not_publish_incomplete_metadata(self):
        self.accepted_metadata()
        before = tool.release_selection(self.config)
        with patch.object(os, 'fchown', side_effect=OSError('synthetic-owner-failure')):
            with self.assertRaisesRegex(OSError, 'owner-failure'):
                self.update(wizard=self.wizard, release_metadata=self.metadata)
        self.assertEqual(tool.release_selection(self.config), before)
        with patch.object(successor, 'process_start', return_value='different-process'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(tool.release_selection(self.config), before)

    def test_partial_metadata_rollback_can_resume_and_removes_initially_absent_receipts(self):
        self.accepted_metadata(existing=False)
        self.update(wizard=self.wizard, release_metadata=self.metadata)
        unlink = Path.unlink
        def fail_second_unlink(path, *args, **kwargs):
            if path == self.config['_main'].parent / '.release-images.env':
                raise recovery.RecoveryError('synthetic-selection-unlink-failure')
            return unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', fail_second_unlink):
            with self.assertRaisesRegex(recovery.RecoveryError, 'selection-unlink-failure'):
                tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        with patch.object(successor, 'process_start', return_value='different-process'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(tool.release_selection(self.config)[0], {name: None for name in tool.RELEASE_SELECTION})
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)

    def test_metadata_drift_or_changed_checkpoint_blocks_rollback_before_stop(self):
        self.accepted_metadata()
        self.update(wizard=self.wizard, release_metadata=self.metadata)
        path = self.config['_main'].parent / '.release-images.json'
        after = path.read_bytes()
        for drift in ('live', 'checkpoint'):
            if drift == 'live': successor.atomic_bytes(path, b'{"operator":"changed"}\n')
            else:
                successor.atomic_bytes(path, after)
                successor.atomic_bytes(self.checkpoint / '.release-images.json.before', b'changed checkpoint\n')
            count = len(self.commands)
            with self.subTest(drift=drift), self.assertRaisesRegex(recovery.RecoveryError, 'public-release-selection'):
                tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
            self.assertFalse(any('stop' in command for command in self.commands[count:]))

    def test_metadata_requires_pair_and_refuses_unsafe_or_incomplete_selection(self):
        self.accepted_metadata()
        with self.assertRaisesRegex(recovery.RecoveryError, 'requires-paired'):
            self.update(release_metadata=self.metadata)
        path = self.config['_main'].parent / '.release-images.json'
        path.unlink()
        with self.assertRaisesRegex(recovery.RecoveryError, 'selection-incomplete'):
            self.update(wizard=self.wizard, release_metadata=self.metadata)
        path.symlink_to(self.root / 'absent')
        with self.assertRaisesRegex(recovery.RecoveryError, 'private-regular-input'):
            self.update(wizard=self.wizard, release_metadata=self.metadata)
        self.assertEqual(self.commands, [])

    def test_metadata_rechecks_selection_under_lease_before_stopping(self):
        self.accepted_metadata()
        acquire = successor.Lease.__enter__
        path = self.config['_main'].parent / '.release-images.json'
        changed = b'{"operator":"changed during preflight"}\n'
        def acquire_then_edit(lease):
            result = acquire(lease)
            successor.atomic_bytes(path, changed)
            return result
        with patch.object(successor.Lease, '__enter__', acquire_then_edit):
            with self.assertRaisesRegex(recovery.RecoveryError, 'public-release-selection-changed'):
                self.update(wizard=self.wizard, release_metadata=self.metadata)
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertEqual(path.read_bytes(), changed)
        self.assertEqual(self.commands, [])
        self.assertFalse((self.root / 'configuration/.storage-operation-lock').exists())

    def test_pair_changes_only_release_pins_and_keeps_source_primary_configuration(self):
        self.enable_pair()
        binding = self.root / 'configuration/.projects.env/.wizard.env'
        binding.write_text('fixture canonical binding kept exactly\n')
        expected = tool.assignment(tool.assignment(self.raw, self.new), self.wizard, 'WIZARD_IMAGE')
        record = self.update(wizard=self.wizard)
        self.assertEqual(self.config['_main'].read_bytes(), expected)
        self.assertEqual(expected[:1184], self.raw[:1184])
        self.assertEqual(binding.read_text(), 'fixture canonical binding kept exactly\n')
        self.assertEqual(record['previousWizard']['imageId'], self.wizard_template['Image'])
        self.assertTrue(record['otherServiceImagesPreserved'])
        before = json.loads((self.checkpoint / 'baseline-before.json').read_bytes())
        after = json.loads((self.checkpoint / 'baseline-after.json').read_bytes())
        for name in before['selectedImages']:
            if name not in ('system_bootstrapper_1', 'system_wizard_1'):
                self.assertEqual(before['selectedImages'][name], after['selectedImages'][name])
        self.assertEqual(self.rows['system_wizard_1']['Image'], self.release['wizardImageId'])

    def test_pair_preflight_and_bad_Wizard_image_do_not_mutate_services(self):
        self.enable_pair()
        self.assertEqual(self.update(wizard=self.wizard, check_only=True)['phase'], 'preflight-passed')
        for key, value in [('imageId', 'sha256:' + '0' * 64), ('candidateJobId', 900)]:
            old = self.pulled_wizard[key]; self.pulled_wizard[key] = value
            with self.assertRaisesRegex(recovery.RecoveryError, 'public-Wizard-does-not-match'):
                self.update(wizard=self.wizard)
            self.pulled_wizard[key] = old
        self.assertEqual(self.commands, [])
        self.assertFalse(self.checkpoint.exists())
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)

    def test_pair_refuses_disabled_or_foreign_Wizard_before_checkpoint(self):
        self.enable_pair()
        self.config['WIZARD_ENABLE'] = 'false'
        with self.assertRaisesRegex(recovery.RecoveryError, 'enabled-Wizard'):
            self.update(wizard=self.wizard, check_only=True)
        self.config['WIZARD_ENABLE'] = 'true'
        self.rows['system_wizard_1']['Config']['Labels']['com.docker.compose.service'] = 'foreign'
        with self.assertRaisesRegex(recovery.RecoveryError, 'owned-core-container-required'):
            self.update(wizard=self.wizard, check_only=True)
        self.assertFalse(self.checkpoint.exists())
        self.assertEqual(self.commands, [])

    def test_pair_rechecks_publication_under_lease_before_stopping_services(self):
        self.enable_pair()
        verify = successor.verify_public_pair
        calls = 0
        def changed_publication(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                self.source['wizardRevision'] = '0' * 40
            return verify(*args)
        with patch.object(successor, 'verify_public_pair', side_effect=changed_publication):
            with self.assertRaisesRegex(recovery.RecoveryError, 'source-publication-mismatch'):
                self.update(wizard=self.wizard)
        self.assertEqual(calls, 2)
        self.assertFalse(any('stop' in command for command in self.commands))
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertFalse((self.root / 'configuration/.storage-operation-lock').exists())

    def test_pair_rollback_restores_both_images_and_configuration_without_CI_API(self):
        self.enable_pair()
        self.update(wizard=self.wizard)
        with patch.object(successor, 'verify_public_pair', side_effect=AssertionError('CI API not needed')):
            record = tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(record['phase'], 'rolled-back')
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertEqual(self.rows['system_wizard_1']['Image'], self.wizard_template['Image'])
        self.assertEqual(self.rows['system_bootstrapper_1']['Image'], self.controller_template['Image'])

    def test_interrupted_pair_handles_missing_Wizard_and_controller_with_owned_lease(self):
        self.enable_pair()
        self.compose_fail = True
        with self.assertRaisesRegex(recovery.RecoveryError, 'compose-failure'): self.update(wizard=self.wizard)
        del self.rows['system_bootstrapper_1']; del self.rows['system_wizard_1']
        self.compose_fail = False
        with patch.object(successor, 'process_start', return_value='different-process'):
            record = tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(record['phase'], 'rolled-back')
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertEqual(self.rows['system_wizard_1']['Image'], self.wizard_template['Image'])

    def test_pair_rollback_refuses_unrelated_Wizard_and_unavailable_previous_image(self):
        self.enable_pair()
        self.update(wizard=self.wizard)
        self.rows['system_wizard_1']['Image'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(recovery.RecoveryError, 'unrelated-Wizard'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.rows['system_wizard_1']['Image'] = self.release['wizardImageId']
        previous = json.loads((self.checkpoint / 'operation.json').read_bytes())['previousWizard']['reference']
        self.images[previous]['Id'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(recovery.RecoveryError, 'previous-Wizard-image-unavailable'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')

    def test_pair_rollback_refuses_changed_canonical_binding_before_stopping_services(self):
        self.enable_pair()
        binding = self.root / 'configuration/.projects.env/.wizard.env'
        binding.write_text('canonical binding\n')
        self.update(wizard=self.wizard)
        binding.write_text('operator changed binding\n')
        commands_before = len(self.commands)
        with self.assertRaisesRegex(recovery.RecoveryError, 'saved-configuration-changed'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertFalse(any('stop' in command for command in self.commands[commands_before:]))

    def test_controller_only_update_retains_config_pins_data_and_exact_previous_image(self):
        record = self.update(redirect_from='https://alias.example.invalid')
        self.assertEqual(record['phase'], 'completed')
        self.assertEqual(self.config['_main'].read_bytes(), tool.assignment(self.raw, self.new))
        self.assertEqual((self.checkpoint / 'main-before.env').read_bytes(), self.raw)
        self.assertEqual((self.checkpoint / 'main-after.env').read_bytes(), tool.assignment(self.raw, self.new))
        before = json.loads((self.checkpoint / 'baseline-before.json').read_bytes())
        after = json.loads((self.checkpoint / 'baseline-after.json').read_bytes())
        self.assertGreater(after['startedAt'], before['startedAt'])
        self.assertEqual(self.contacts.call_args.args[1]['startedAt'], after['startedAt'])
        for name in before['selectedImages']:
            if name != 'system_bootstrapper_1':
                self.assertEqual(before['selectedImages'][name], after['selectedImages'][name])
        self.assertEqual(record['previousController']['imageId'], self.images[self.old]['Id'])
        self.assertFalse((self.root / 'recovery/images.json').exists())
        self.assertFalse((self.root / 'configuration/.storage-operation-lock').exists())
        self.assertTrue(any('--no-build' in command and '--no-deps' in command and '--pull' in command
                            and 'never' in command for command in self.commands))
        self.assertFalse(any('gitlab' in command or 'prune' in command for command in self.commands))
        self.assertEqual(self.routes.call_args.args[2], 'https://alias.example.invalid')
        self.assertEqual(self.probe.call_args.args[0]['fromVersion'], 'new')

    def test_check_only_does_not_write_checkpoint_or_configuration_or_stop_services(self):
        self.assertEqual(self.update(check_only=True)['phase'], 'preflight-passed')
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertFalse(self.checkpoint.exists())
        self.assertEqual(self.commands, [])

    def test_preflight_waits_for_recent_runner_contact_without_mutation(self):
        self.contacts.side_effect = [recovery.RecoveryError('runner-manager-contact-not-fresh'),
                                     {'checked': True, 'online': 2}]
        with patch.object(tool.time, 'sleep') as sleep:
            self.assertEqual(self.update(check_only=True)['phase'], 'preflight-passed')
        sleep.assert_called_once_with(3)
        self.assertEqual(self.commands, [])
        self.assertFalse(self.checkpoint.exists())

    def test_assignment_preserves_multiline_values_and_handles_indentation(self):
        secret = b"export OTHER='literal text\nexport BOOTSTRAPPER_IMAGE=inside-secret\nlast line'\n"
        raw = self.raw + secret
        self.assertTrue(tool.assignment(raw, self.new).endswith(secret))
        indented = self.raw.replace(b'export BOOTSTRAPPER_IMAGE=', b'  export\tBOOTSTRAPPER_IMAGE=')
        self.assertEqual(tool.assignment(indented, self.new), tool.assignment(self.raw, self.new))
        with self.assertRaisesRegex(recovery.RecoveryError, 'duplicate-or-header'):
            tool.assignment(self.raw + b"\t export\tBOOTSTRAPPER_IMAGE='" + self.old.encode() + b"'\n", self.new)
        with self.assertRaisesRegex(recovery.RecoveryError, 'incomplete-controller'):
            tool.assignment(self.raw + b"export SECRET='unclosed\n", self.new)
        with self.assertRaisesRegex(recovery.RecoveryError, 'unsupported-controller'):
            tool.assignment(self.raw + b'echo unsupported-command\n', self.new)

    def test_wrong_public_image_or_candidate_job_blocks_before_mutation(self):
        for field, value in [('imageId', 'sha256:' + '9' * 64), ('candidateJobId', 404)]:
            saved = copy.deepcopy(self.pulled)
            self.pulled[field] = value
            with self.assertRaisesRegex(recovery.RecoveryError, 'accepted-candidate'):
                self.update()
            self.pulled = saved
        self.assertFalse(self.checkpoint.exists())
        self.assertEqual(self.commands, [])

    def test_advanced_default_branch_or_disabled_merge_gate_blocks(self):
        self.api.branch['commit']['id'] = '9' * 40
        with self.assertRaisesRegex(recovery.RecoveryError, 'branch-advanced'): self.update()
        self.api.branch['commit']['id'] = self.release['sourceRevision']
        self.api.project['only_allow_merge_if_pipeline_succeeds'] = False
        with self.assertRaisesRegex(recovery.RecoveryError, 'merge-gate-disabled'): self.update()
        self.assertEqual(self.commands, [])

    def test_already_current_GitLab_and_runner_images_required(self):
        self.evidence['evidence']['gitlabUpgrade']['toImageId'] = 'sha256:' + '8' * 64
        self.api.evidence = copy.deepcopy(self.evidence)
        self.api.release['candidateEvidenceSha256'] = self.release['candidateEvidenceSha256'] = hashlib.sha256(
            json.dumps(self.evidence).encode()).hexdigest()
        with self.assertRaisesRegex(recovery.RecoveryError, 'current-GitLab'): self.update()
        self.evidence['evidence']['gitlabUpgrade']['toImageId'] = self.evidence['images']['gitlab']
        self.evidence['evidence']['gitlabUpgrade']['runnerImageId'] = 'sha256:' + '8' * 64
        self.api.evidence = copy.deepcopy(self.evidence)
        self.api.release['candidateEvidenceSha256'] = self.release['candidateEvidenceSha256'] = hashlib.sha256(
            json.dumps(self.evidence).encode()).hexdigest()
        with self.assertRaisesRegex(recovery.RecoveryError, 'current-runner'): self.update()
        self.assertEqual(self.commands, [])

    def test_existing_manifest_is_not_bypassed_and_explicit_mode_required(self):
        (self.root / 'recovery').mkdir()
        (self.root / 'recovery/images.json').write_text('{}')
        with self.assertRaisesRegex(recovery.RecoveryError, 'refuses-recovery-manifest'): self.update()
        (self.root / 'recovery/images.json').unlink()
        baseline = runtime.capture(self.config, ROOT, public=True)
        with self.assertRaisesRegex(recovery.RecoveryError, 'image-mode-mismatch'):
            runtime.verify(self.config, baseline, ROOT)
        (self.root / 'recovery/images.json').symlink_to(self.root / 'absent')
        with self.assertRaisesRegex(recovery.RecoveryError, 'refuses-recovery-manifest'):
            runtime.assert_baseline(self.config, baseline)

    def test_DockerHub_prefix_normalizes_both_ways_but_private_registry_port_is_exact(self):
        runtime.public_images(self.config, self.rows)
        self.config['BOOTSTRAPPER_IMAGE'] = self.old.removeprefix('docker.io/')
        self.images[self.config['BOOTSTRAPPER_IMAGE']] = self.images[self.old]
        self.images[self.old]['RepoDigests'] = [self.old]
        runtime.public_images(self.config, self.rows)
        self.images[self.config['WIZARD_IMAGE']]['RepoDigests'] = [self.config['WIZARD_IMAGE'].replace(':5443/', '/')]
        with self.assertRaisesRegex(recovery.RecoveryError, 'digest-not-verified'):
            runtime.public_images(self.config, self.rows)

    def test_public_mode_requires_public_controller_digest_and_retained_identical_selections(self):
        baseline = runtime.capture(self.config, ROOT, public=True)
        self.images['nginx']['Id'] = self.rows['system_web_1']['Image'] = 'sha256:' + '8' * 64
        with self.assertRaisesRegex(recovery.RecoveryError, 'public-service-image-changed'):
            runtime.verify(self.config, baseline, ROOT, public=True)
        self.config['BOOTSTRAPPER_IMAGE'] = 'local-controller:mutable'
        with self.assertRaisesRegex(recovery.RecoveryError, 'public-controller-digest-required'):
            runtime.public_images(self.config, self.rows)

    def test_completed_update_can_rollback_without_API_or_data_rewind(self):
        self.update()
        with patch.object(successor, 'verify_pipeline', side_effect=AssertionError('API must not be required')):
            record = tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(record['phase'], 'rolled-back')
        self.assertFalse(record['databaseRewound'])
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertEqual(self.rows['system_bootstrapper_1']['Image'], self.images[self.old]['Id'])
        self.assertFalse((self.root / 'configuration/.storage-operation-lock').exists())

    def test_interrupted_start_retains_lease_then_rollback_adopts_without_rewinding_data(self):
        self.compose_fail = True
        with self.assertRaisesRegex(recovery.RecoveryError, 'compose-failure'): self.update()
        self.assertTrue((self.root / 'configuration/.storage-operation-lock').exists())
        self.assertEqual(self.config['_main'].read_bytes(), tool.assignment(self.raw, self.new))
        self.compose_fail = False
        with patch.object(successor, 'process_start', return_value='different-process'):
            record = tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(record['phase'], 'rolled-back')
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertFalse((self.root / 'configuration/.gitlab-upgrade-lock').exists())

    def test_rollback_refuses_later_configuration_or_service_image_changes(self):
        self.update()
        current = self.config['_main'].read_bytes()
        successor.atomic_bytes(self.config['_main'], current + b'export OPERATOR_EDIT=preserved\n')
        with self.assertRaisesRegex(recovery.RecoveryError, 'configuration-changed'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        successor.atomic_bytes(self.config['_main'], current)
        self.rows['system_gitlab_1']['Image'] = 'sha256:' + '8' * 64
        with self.assertRaisesRegex(recovery.RecoveryError, 'service-image-changed'):
            tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')

    def test_rollback_recreates_controller_after_proven_absence(self):
        self.compose_fail = True
        with self.assertRaisesRegex(recovery.RecoveryError, 'compose-failure'): self.update()
        del self.rows['system_bootstrapper_1']
        self.compose_fail = False
        with patch.object(successor, 'process_start', return_value='different-process'):
            record = tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(record['phase'], 'rolled-back')
        self.assertEqual(self.config['_main'].read_bytes(), self.raw)
        self.assertEqual(self.rows['system_bootstrapper_1']['Image'], self.images[self.old]['Id'])

    def test_failed_controller_list_is_not_assumed_to_prove_absence(self):
        self.update()
        with patch.object(tool, 'run', side_effect=recovery.RecoveryError('synthetic-daemon-failure')):
            with self.assertRaisesRegex(recovery.RecoveryError, 'daemon-failure'):
                tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(self.config['_main'].read_bytes(), tool.assignment(self.raw, self.new))

    def test_rollback_rechecks_config_after_lease_and_releases_without_stopping(self):
        self.update()
        acquire = successor.Lease.__enter__
        changed = self.config['_main'].read_bytes() + b'export OPERATOR_EDIT=preserved\n'
        def acquire_then_edit(lease):
            result = acquire(lease)
            successor.atomic_bytes(self.config['_main'], changed)
            return result
        commands_before = len(self.commands)
        with patch.object(successor.Lease, '__enter__', acquire_then_edit):
            with self.assertRaisesRegex(recovery.RecoveryError, 'configuration-changed'):
                tool.rollback(self.config, self.checkpoint, '/private/synthetic-token')
        self.assertEqual(self.config['_main'].read_bytes(), changed)
        self.assertFalse((self.root / 'configuration/.storage-operation-lock').exists())
        self.assertFalse(any('stop' in command for command in self.commands[commands_before:]))


if __name__ == '__main__': unittest.main()
