"""Public release selection: real source identities, guarded files and no builds."""
import argparse
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
spec = importlib.util.spec_from_file_location('public_release', ROOT / 'bootstrapper/install-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
CONTROLLER = 'docker.io/example/system@sha256:' + 'a' * 64
WIZARD = 'docker.io/example/wizard@sha256:' + 'b' * 64


class PublicRelease(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='public-release-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.checkout = self.directory / 'checkout'
        self.checkout.mkdir()
        self.root = self.directory / 'live'
        (self.root / 'configuration').mkdir(parents=True)
        self.selector = self.directory / 'persistence.env'
        self.selector.write_text('PERSISTENCE_MODE=local\nPERSISTENT_MOUNT=/\nPERSISTENT_DIR=' + str(self.root) + '\n')
        self.selector.chmod(0o600)
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.checkout / 'source.txt').write_text('committed source\n')
        (self.checkout / 'wizard').mkdir()
        self.git('add', 'source.txt')
        self.wizard = 'c' * 40
        self.git('update-index', '--add', '--cacheinfo', '160000,' + self.wizard + ',wizard')
        self.git('commit', '--quiet', '-m', 'Fixture')
        self.identity = release.source_identity(self.checkout)
        self.args = argparse.Namespace(controller=CONTROLLER, wizard=WIZARD,
                                       persistence_env=self.selector, install_host=False)

    def git(self, *arguments):
        return subprocess.check_output(['git', '-C', str(self.checkout), *arguments], stderr=subprocess.DEVNULL)

    def image(self, wizard=False):
        selected = WIZARD if wizard else CONTROLLER
        labels = {'org.opencontainers.image.revision': self.wizard if wizard else self.identity['sourceCommit'],
                  'org.system-bootstrapper.test-job': '20'}
        if wizard:
            labels['org.system-bootstrapper.source-revision'] = self.identity['sourceCommit']
        return {'Id': 'sha256:' + ('e' if wizard else 'd') * 64, 'Os': 'linux', 'Architecture': 'amd64',
                'RepoDigests': [selected.removeprefix('docker.io/')], 'Config': {'Labels': labels}}

    def metadata(self):
        return {'format': 'system-accepted-release-v1', 'version': '1.0.0', 'tag': 'v1.0.0',
                'platform': 'linux/amd64', 'source': {'revision': self.identity['sourceCommit'],
                    'tree': self.identity['sourceTree'], 'wizardRevision': self.wizard},
                'images': {role: {'reference': selected, 'imageId': 'sha256:' + image * 64,
                                 'configDigest': 'sha256:' + image * 64}
                           for role, selected, image in [('controller', CONTROLLER, 'd'), ('wizard', WIZARD, 'e')]},
                'acceptance': {'candidateJobId': 20, 'controllerWizardSameAttempt': True, 'requiredChecksPassed': True}}

    def test_accepted_public_manifest_is_bound_to_exact_source_and_pair(self):
        manifest = self.directory / 'release.json'
        value = self.metadata()
        manifest.write_text(json.dumps(value))
        self.assertEqual(release.accepted_metadata(manifest, self.identity, CONTROLLER, WIZARD), value)
        for category in ('source', 'image', 'candidate', 'version'):
            changed = self.metadata()
            if category == 'source':
                changed['source']['wizardRevision'] = '0' * 40
            elif category == 'image':
                changed['images']['wizard']['reference'] = CONTROLLER
            elif category == 'candidate':
                changed['acceptance']['controllerWizardSameAttempt'] = False
            else:
                changed['version'] = '01.0.0'
            manifest.write_text(json.dumps(changed))
            with self.subTest(category=category), self.assertRaises(release.ReleaseError):
                release.accepted_metadata(manifest, self.identity, CONTROLLER, WIZARD)

    def test_manifest_refuses_another_tested_attempt_before_writing_selectors(self):
        manifest = self.directory / 'release.json'
        manifest.write_text(json.dumps(self.metadata()))
        self.args.release_metadata = manifest
        selected = {'PERSISTENCE_MODE': 'local', 'PERSISTENT_MOUNT': '/', 'PERSISTENT_DIR': str(self.root), 'PERSISTENT_UUID': ''}
        def image(reference, identity, **options):
            return {'reference': reference, 'imageId': 'sha256:' + ('e' if options.get('wizard') else 'd') * 64,
                    'candidateJobId': 21, 'platform': 'linux/amd64'}
        with patch.object(release, 'storage', return_value=(selected, self.root)), \
                patch.object(release, 'checked_image', side_effect=image), patch.object(release, 'no_existing_services'), \
                patch.object(release, 'GUARD_DIRECTORY', self.directory / 'guard'), \
                self.assertRaisesRegex(release.ReleaseError, 'accepted-public-attempt'):
            release.install(self.args, self.checkout)
        self.assertFalse((self.root / 'configuration/.release-images.env').exists())
        self.assertFalse((self.root / 'configuration/.release-images.json').exists())

    def test_exact_manifest_digest_remains_portable_between_docker_image_stores(self):
        manifest = self.directory / 'release.json'
        manifest.write_text(json.dumps(self.metadata()))
        self.args.release_metadata = manifest
        selected = {'PERSISTENCE_MODE': 'local', 'PERSISTENT_MOUNT': '/', 'PERSISTENT_DIR': str(self.root), 'PERSISTENT_UUID': ''}
        def command(arguments, **options):
            return subprocess.check_output(arguments, stderr=subprocess.DEVNULL) if arguments[0] == 'git' else b''
        def image(reference, identity, **options):
            return {'reference': reference, 'imageId': reference.split('@')[1],
                    'candidateJobId': 20, 'platform': 'linux/amd64'}
        with patch.object(release, 'run', side_effect=command), \
                patch.object(release, 'storage', return_value=(selected, self.root)), \
                patch.object(release, 'checked_image', side_effect=image), \
                patch.object(release, 'GUARD_DIRECTORY', self.directory / 'guard'):
            result = release.install(self.args, self.checkout)
        self.assertEqual(result['status'], 'startup-requested')
        self.assertEqual(result['productRelease']['version'], '1.0.0')
        self.assertEqual(result['images']['controller']['imageId'], CONTROLLER.split('@')[1])
        self.assertNotEqual(result['images']['controller']['imageId'], self.metadata()['images']['controller']['imageId'])

    def test_public_digest_required(self):
        self.assertEqual(release.reference(CONTROLLER.removeprefix('docker.io/')), CONTROLLER)
        for value in ('example/system:latest', 'registry.example.com/system@sha256:' + 'a' * 64,
                      'localhost/system@sha256:' + 'a' * 64, CONTROLLER + '\n',
                      CONTROLLER.replace('a' * 64, 'A' * 64), CONTROLLER + ';id'):
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.reference(value)

    def test_dirty_source_refused_before_network(self):
        (self.checkout / 'source.txt').write_text('unreviewed change')
        with self.assertRaisesRegex(release.ReleaseError, 'modified'):
            release.source_identity(self.checkout)

    def test_missing_gitlink_refused(self):
        self.git('update-index', '--force-remove', 'wizard')
        self.git('commit', '--quiet', '-m', 'No Wizard')
        with self.assertRaisesRegex(release.ReleaseError, 'identities'):
            release.source_identity(self.checkout)

    def test_correct_public_pair(self):
        for wizard in (False, True):
            row = self.image(wizard)
            with patch.object(release, 'run', side_effect=[b'', json.dumps([row]).encode()]) as command:
                result = release.checked_image(WIZARD if wizard else CONTROLLER, self.identity, wizard=wizard)
            self.assertEqual(result['imageId'], row['Id'])
            self.assertEqual(result['candidateJobId'], 20)
            self.assertEqual(result['platform'], 'linux/amd64')
            self.assertEqual(command.call_args_list[0].args[0][2], 'pull')

    def test_unsupported_platform_and_unbound_candidate_job_refused(self):
        for field, value in [('Os', 'windows'), ('Architecture', 'arm64'), ('job', ''),
                             ('job', '0'), ('job', 'not-a-job'), ('job', 20),
                             ('job', str(2 ** 53))]:
            row = self.image()
            if field == 'job':
                row['Config']['Labels']['org.system-bootstrapper.test-job'] = value
            else:
                row[field] = value
            with self.subTest(field=field, value=value), \
                    patch.object(release, 'run', side_effect=[b'', json.dumps([row]).encode()]), \
                    self.assertRaises(release.ReleaseError):
                release.checked_image(CONTROLLER, self.identity)

    def test_wrong_digest_or_source_refused(self):
        for field in ('digest', 'system', 'wizard', 'binding'):
            row = self.image(wizard=True)
            if field == 'digest':
                row['RepoDigests'] = [CONTROLLER]
            elif field == 'system':
                row = self.image()
                row['Config']['Labels']['org.opencontainers.image.revision'] = '0' * 40
            elif field == 'wizard':
                row['Config']['Labels']['org.opencontainers.image.revision'] = '0' * 40
            else:
                row['Config']['Labels']['org.system-bootstrapper.source-revision'] = '0' * 40
            with self.subTest(field=field), patch.object(release, 'run', side_effect=[b'', json.dumps([row]).encode()]), \
                    self.assertRaises(release.ReleaseError):
                release.checked_image(CONTROLLER if field == 'system' else WIZARD,
                                      self.identity, wizard=field != 'system')

    def test_existing_configuration_and_data_refused(self):
        for relative in ('configuration/.docker.env', 'gitlab/config/gitlab.rb', 'gitlab/data/database'):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('retained user data')
            with self.subTest(relative=relative), self.assertRaisesRegex(release.ReleaseError, 'fresh-install'):
                release.fresh(self.root, self.checkout)
            target.unlink()
        link = self.root / 'configuration/.docker.env'
        link.symlink_to(self.directory / 'missing')
        with self.assertRaises(release.ReleaseError):
            release.fresh(self.root, self.checkout)

    def test_existing_controller_refused(self):
        with patch.object(release, 'run', return_value=b'existing-controller\n'), \
                self.assertRaisesRegex(release.ReleaseError, 'existing-system-container'):
            release.no_existing_services()

    def test_old_named_volumes_refused_before_they_can_be_reused(self):
        with patch.object(release, 'run', side_effect=[b'', b'', b'system_configuration\n']), \
                self.assertRaisesRegex(release.ReleaseError, 'existing-system-volumes'):
            release.no_existing_services()

    def test_private_outputs_refuse_links_and_broad_permissions(self):
        target = self.root / 'configuration/.release-images.env'
        target.symlink_to(self.directory / 'other')
        with self.assertRaises(release.ReleaseError):
            release.write_private(target, b'unchanged')
        target.unlink()
        target.write_bytes(b'existing')
        target.chmod(0o644)
        with self.assertRaises(release.ReleaseError):
            release.write_private(target, b'unchanged')
        self.assertEqual(target.read_bytes(), b'existing')

    def test_explicit_volume_failure_does_not_create_local_data(self):
        self.selector.write_text('PERSISTENCE_MODE=volume\nPERSISTENT_MOUNT=/missing-backup\nPERSISTENT_DIR=/missing-backup/platform\n')
        commands = []

        def command(arguments, **options):
            commands.append((arguments, options))
            if arguments[0] == 'bash' and arguments[1] == '-c':
                return b'volume\0/missing-backup\0/missing-backup/platform\0\0'
            raise release.ReleaseError('persistent-storage-preflight-failed')

        with patch.object(release, 'run', side_effect=command), self.assertRaises(release.ReleaseError):
            release.storage(self.selector, self.checkout)
        self.assertEqual(commands[-1][1]['environment']['PERSISTENCE_CHECK_ONLY'], '1')
        self.assertFalse((self.root / '.system-bootstrapper-volume').exists())

    def test_install_records_only_image_defaults_and_requests_native_no_build(self):
        calls = []
        selected = {'PERSISTENCE_MODE': 'local', 'PERSISTENT_MOUNT': '/',
                    'PERSISTENT_DIR': str(self.root), 'PERSISTENT_UUID': ''}

        def command(arguments, **options):
            calls.append((arguments, options))
            if arguments[0] == 'git':
                return subprocess.check_output(arguments, stderr=subprocess.DEVNULL)
            return b''

        def image(selected, identity, **options):
            return {'reference': selected, 'imageId': 'sha256:' + 'd' * 64,
                    'candidateJobId': 20, 'platform': 'linux/amd64'}

        with patch.object(release, 'run', side_effect=command), \
                patch.object(release, 'storage', return_value=(selected, self.root)), \
                patch.object(release, 'checked_image', side_effect=image), \
                patch.object(release, 'GUARD_DIRECTORY', self.directory / 'guard'), \
                patch.object(release.os, 'geteuid', return_value=0):
            result = release.install(self.args, self.checkout)
        profile = self.root / 'configuration/.release-images.env'
        self.assertEqual(profile.read_text(), 'BOOTSTRAPPER_IMAGE=' + CONTROLLER + '\nWIZARD_IMAGE=' + WIZARD + '\n')
        self.assertEqual(profile.stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / 'configuration/.docker.env').exists())
        self.assertEqual(result['status'], 'startup-requested')
        self.assertEqual(result['sourceCommit'], self.identity['sourceCommit'])
        startup = [call for call in calls if call[0][-1] == str(self.checkout / 'start.sh')]
        self.assertEqual(len(startup), 1)
        self.assertEqual(startup[0][1]['environment']['SYSTEM_BOOTSTRAPPER_SKIP_BUILD'], '1')
        self.assertFalse(any('build' in call[0] for call in calls))

    def test_same_source_images_from_different_candidate_attempts_cannot_start(self):
        selected = {'PERSISTENCE_MODE': 'local', 'PERSISTENT_MOUNT': '/',
                    'PERSISTENT_DIR': str(self.root), 'PERSISTENT_UUID': ''}
        pair = [{'reference': CONTROLLER, 'imageId': 'sha256:' + 'd' * 64,
                 'candidateJobId': 20, 'platform': 'linux/amd64'},
                {'reference': WIZARD, 'imageId': 'sha256:' + 'e' * 64,
                 'candidateJobId': 21, 'platform': 'linux/amd64'}]
        with patch.object(release, 'source_identity', return_value=self.identity), \
                patch.object(release, 'storage', return_value=(selected, self.root)), \
                patch.object(release, 'checked_image', side_effect=pair), \
                patch.object(release, 'no_existing_services'), \
                patch.object(release, 'GUARD_DIRECTORY', self.directory / 'guard'), \
                patch.object(release.os, 'geteuid', return_value=0), \
                patch.object(release, 'run') as commands, \
                self.assertRaisesRegex(release.ReleaseError, 'one-accepted-candidate-job'):
            release.install(self.args, self.checkout)
        self.assertFalse((self.root / 'configuration/.release-images.env').exists())
        self.assertFalse((self.root / 'configuration/.release-images.json').exists())
        commands.assert_not_called()


if __name__ == '__main__':
    unittest.main()
