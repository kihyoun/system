#!/usr/bin/env python3
"""Native host tools: isolated fixtures only, no Docker socket or real mounts."""
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


recovery = module('recovery_test', ROOT / 'bootstrapper/recovery.py')
runtime = module('runtime_test', ROOT / 'bootstrapper/verify-runtime.py')


def verify_images(config, manifest, services):
    selectors = recovery.host_operation('runtimeImageSelectors', config)
    references = set(selectors.values()) | {config['GITLAB_RUNNER_IMAGE']}
    return runtime.recovery.host_operation('verifyImageInspections', config, manifest, services,
                                   {reference: runtime.recovery.inspect_image(reference) for reference in references})


class RecoveryManifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-native-init-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.checkout = self.root / 'checkout'
        self.checkout.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.checkout), *args], stderr=subprocess.DEVNULL).decode().strip()
        self.git = git
        git('init', '-q')
        (self.checkout / 'tracked').write_text('source\n')
        git('add', 'tracked')
        self.wizard = 'b' * 40
        git('update-index', '--add', '--cacheinfo', '160000,' + self.wizard + ',wizard')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        self.directory = self.root / 'recovery'
        (self.directory / 'images').mkdir(parents=True)
        self.archive = self.directory / 'images/controller.tar.gz'
        self.archive.write_bytes(b'declared test archive')
        self.image = 'sha256:' + 'a' * 64
        commit, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')
        self.manifest = {
            'sourceCommit': commit, 'sourceTree': tree, 'wizardSourceRevision': self.wizard,
            'archives': [{'file': 'images/controller.tar.gz', 'sha256': recovery.sha(self.archive),
                          'imageId': self.image, 'sourceCommit': commit, 'sourceTree': tree,
                          'wizardSourceRevision': self.wizard}],
            'publicImages': [{'reference': 'nginx@sha256:' + 'c' * 64, 'tag': 'nginx:retained',
                              'imageId': 'sha256:' + 'c' * 64}],
            'localImages': [{'tag': 'system_bootstrapper', 'imageId': self.image},
                            {'tag': 'controller:retained', 'imageId': self.image}],
            'currentController': {'reference': 'controller:retained', 'imageId': self.image,
                                  'sourceCommit': commit, 'sourceTree': tree}}
        self.path = self.directory / 'images.json'
        self.save()

    def save(self):
        self.path.write_text(json.dumps(self.manifest))

    def verify(self, **kwargs):
        return recovery.load_manifest(self.directory, self.checkout, **kwargs)

    def test_manifest_validates_recorded_source_even_with_newer_host_tools(self):
        (self.checkout / 'tracked').write_text('new reviewed host tool\n')
        self.git('add', 'tracked')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'newer tools')
        self.assertEqual(self.verify()['sourceCommit'], self.manifest['sourceCommit'])

    def test_checksum_is_checked_before_any_image_load(self):
        self.archive.write_bytes(b'corrupt payload')
        with self.assertRaisesRegex(recovery.RecoveryError, 'checksum-mismatch'):
            self.verify()

    def test_tagged_digest_keeps_repository_and_registry_port_identity(self):
        digest = 'sha256:' + 'a' * 64
        self.assertEqual(recovery.canonical_digest('registry.example.invalid:5050/group/app:release@' + digest),
                         'registry.example.invalid:5050/group/app@' + digest)
        self.assertEqual(recovery.canonical_digest('gitlab/gitlab-ce:release@' + digest),
                         'gitlab/gitlab-ce@' + digest)
        self.assertNotEqual(recovery.canonical_digest('other/repository:release@' + digest),
                            'gitlab/gitlab-ce@' + digest)

    def test_only_missing_image_tags_acquire_Docker_latest_semantics(self):
        digest = 'sha256:' + 'a' * 64
        for selected, canonical in [
            ('nginx', 'nginx:latest'),
            ('group/nginx', 'group/nginx:latest'),
            ('registry.example.invalid:5050/group/nginx', 'registry.example.invalid:5050/group/nginx:latest'),
            ('registry.example.invalid:5050/group/nginx:stable', 'registry.example.invalid:5050/group/nginx:stable'),
            ('registry.example.invalid:5050/group/nginx@' + digest, 'registry.example.invalid:5050/group/nginx@' + digest),
            ('nginx:stable@' + digest, 'nginx:stable@' + digest),
            (digest, digest),
        ]:
            with self.subTest(selected=selected):
                self.assertEqual(recovery.canonical_selector(selected), canonical)
        self.assertNotEqual(recovery.canonical_selector('nginx:stable'), recovery.canonical_selector('nginx'))
        self.assertNotEqual(recovery.canonical_selector('group/nginx'), recovery.canonical_selector('nginx'))

    def test_independent_manifest_checksum_is_checked(self):
        with self.assertRaisesRegex(recovery.RecoveryError, 'manifest-checksum-mismatch'):
            self.verify(expected_sha='f' * 64)

    def test_path_traversal_and_symlink_archive_are_rejected(self):
        self.manifest['archives'][0]['file'] = 'images/../controller.tar.gz'
        self.save()
        with self.assertRaisesRegex(recovery.RecoveryError, 'archive-path'):
            self.verify()
        self.manifest['archives'][0]['file'] = 'images/controller.tar.gz'
        self.save()
        self.archive.unlink()
        self.archive.symlink_to('/dev/null')
        with self.assertRaisesRegex(recovery.RecoveryError, 'archive-escapes'):
            self.verify()

    def test_source_tree_gitlink_and_controller_must_agree(self):
        original = copy.deepcopy(self.manifest)
        for key, value, diagnostic in [('sourceTree', 'd' * 40, 'source-tree-mismatch'),
                                       ('wizardSourceRevision', 'e' * 40, 'wizard-gitlink-mismatch')]:
            self.manifest = copy.deepcopy(original)
            self.manifest[key] = value
            self.save()
            with self.assertRaisesRegex(recovery.RecoveryError, diagnostic):
                self.verify()
        self.manifest = original
        self.manifest['currentController']['sourceCommit'] = 'f' * 40
        self.save()
        with self.assertRaisesRegex(recovery.RecoveryError, 'controller-source-mismatch'):
            self.verify()

    def test_aliases_cannot_reference_an_undeclared_image(self):
        self.manifest['localImages'][1]['imageId'] = 'sha256:' + 'f' * 64
        self.save()
        with self.assertRaisesRegex(recovery.RecoveryError, 'no-declared-archive'):
            self.verify()

    def test_duplicate_aliases_and_mutable_public_pins_are_rejected(self):
        self.manifest['localImages'].append(dict(self.manifest['localImages'][0]))
        self.save()
        with self.assertRaisesRegex(recovery.RecoveryError, 'duplicate-image-alias'):
            self.verify()
        self.manifest['localImages'].pop()
        self.manifest['publicImages'][0]['reference'] = 'nginx:latest'
        self.save()
        with self.assertRaisesRegex(recovery.RecoveryError, 'digest-pinned'):
            self.verify()

    def test_equivalent_implicit_and_explicit_latest_aliases_are_duplicates(self):
        self.manifest['publicImages'][0]['tag'] = 'nginx:latest'
        self.manifest['localImages'].append({'tag': 'nginx', 'imageId': self.image})
        self.save()
        with self.assertRaisesRegex(recovery.RecoveryError, 'duplicate-image-alias'):
            self.verify()

    def test_legacy_manifest_can_only_be_audited_not_started(self):
        self.manifest = {key: self.manifest[key] for key in ('archives', 'publicImages')}
        self.save()
        self.verify(checksums_only=True)
        with self.assertRaisesRegex(recovery.RecoveryError, 'local-image-aliases-required'):
            self.verify()
        result = subprocess.run(['python3', str(ROOT / 'bootstrapper/recovery.py'), 'load',
                                 '--directory', str(self.directory), '--checksums-only'], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'legacy-checksums-cannot-load', result.stderr)

    def test_every_declared_local_alias_is_reconstructed(self):
        # The restore orchestration moved to TS; run its injected process-port contract.
        result = subprocess.run(['node', '--test', '--test-name-pattern', 'archive restore reconstructs',
                                 str(ROOT / 'operations/tests/host-recovery-images.test.cjs')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_timed_out_archive_load_stops_before_alias_publication(self):
        # The restore orchestration moved to TS; run its injected process-port contract.
        result = subprocess.run(['node', '--test', '--test-name-pattern', 'failed bounded archive',
                                 str(ROOT / 'operations/tests/host-recovery-images.test.cjs')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_configuration_cannot_select_an_unrecorded_image(self):
        config = self.root / 'settings.env'
        config.write_text('BOOTSTRAPPER_IMAGE=controller:retained\nNGINX_IMAGE=nginx:retained\n'
                          'GITLAB_IMAGE=nginx:retained\nGITLAB_RUNNER_IMAGE=nginx:retained\nWIZARD_ENABLE=false\n')
        recovery.validate_selected_images(self.manifest, config)
        config.write_text(config.read_text() + 'GITLAB_IMAGE=unrecorded:latest\n')
        with self.assertRaisesRegex(recovery.RecoveryError, 'not-declared'):
            recovery.validate_selected_images(self.manifest, config)

    def test_unset_nginx_selection_uses_declared_latest_without_rewriting_inputs(self):
        self.manifest['publicImages'][0]['tag'] = 'nginx:latest'
        self.save()
        config = self.root / 'settings.env'
        config.write_text('BOOTSTRAPPER_IMAGE=controller:retained\nunset NGINX_IMAGE\n'
                          'GITLAB_IMAGE=nginx:latest\nGITLAB_RUNNER_IMAGE=nginx:latest\nWIZARD_ENABLE=false\n')
        before = config.read_bytes(), self.path.read_bytes()
        recovery.validate_selected_images(self.verify(), config)
        runtime_config = {'BOOTSTRAPPER_IMAGE': 'controller:retained', 'NGINX_IMAGE': '',
                          'GITLAB_IMAGE': 'nginx:latest', 'GITLAB_RUNNER_IMAGE': 'nginx:latest',
                          'GITLAB_RUNNER_SCALE': '1', 'WIZARD_ENABLE': 'false'}
        public_image = self.manifest['publicImages'][0]['imageId']
        services = {'system_bootstrapper_1': {'Image': self.image},
                    **{name: {'Image': public_image} for name in
                       ('system_web_1', 'system_gitlab_1', 'runner_docker_1')}}
        def inspect(selected):
            return {'Id': self.image if selected == 'controller:retained' else public_image}
        with patch.object(runtime.recovery, 'inspect_image', side_effect=inspect):
            verify_images(runtime_config, self.manifest, services)
        self.assertEqual((config.read_bytes(), self.path.read_bytes()), before)

        # Matching the default tag does not relax the declared exact image ID.
        def retargeted(selected):
            return {'Id': 'sha256:' + 'f' * 64} if selected == 'nginx' else inspect(selected)
        with patch.object(runtime.recovery, 'inspect_image', side_effect=retargeted):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'image-alias-retargeted'):
                verify_images(runtime_config, self.manifest, services)

        services['system_web_1']['Image'] = 'sha256:' + 'f' * 64
        with patch.object(runtime.recovery, 'inspect_image', side_effect=inspect):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'service-image-selection-mismatch'):
                verify_images(runtime_config, self.manifest, services)

    def test_default_tag_matching_does_not_accept_other_tags_repositories_or_ports(self):
        self.manifest['publicImages'][0]['tag'] = 'registry.example.invalid:5050/group/nginx:latest'
        config = self.root / 'settings.env'
        base = ('BOOTSTRAPPER_IMAGE=controller:retained\n'
                'GITLAB_IMAGE=registry.example.invalid:5050/group/nginx:latest\n'
                'GITLAB_RUNNER_IMAGE=registry.example.invalid:5050/group/nginx:latest\n'
                'WIZARD_ENABLE=false\n')
        config.write_text(base + 'NGINX_IMAGE=registry.example.invalid:5050/group/nginx\n')
        recovery.validate_selected_images(self.manifest, config)
        for selected in ('nginx', 'registry.example.invalid:5050/group/nginx:stable',
                         'registry.example.invalid:5051/group/nginx',
                         'registry.example.invalid:5050/other/nginx'):
            with self.subTest(selected=selected):
                config.write_text(base + 'NGINX_IMAGE=' + selected + '\n')
                with self.assertRaisesRegex(recovery.RecoveryError, 'not-declared'):
                    recovery.validate_selected_images(self.manifest, config)


class RuntimeVerification(unittest.TestCase):
    def test_native_runtime_acceptance(self):
        result = subprocess.run(['node', '--test', str(ROOT / 'operations/tests/host-runtime-inspection.test.cjs')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

if __name__ == '__main__':
    unittest.main()
