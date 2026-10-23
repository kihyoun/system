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
        self.manifest['publicImages'][0]['reference'] = 'nginx:retained@sha256:' + 'c' * 64
        calls = []
        class Unpack:
            stdout = __import__('io').BytesIO(b'archive')
            def wait(self, timeout=None):
                return 0
            def poll(self):
                return 0
        def execute(args, **kwargs):
            calls.append(args)
            return b''
        def inspected(value):
            if value.startswith('nginx'):
                return {'Id': 'sha256:' + 'c' * 64, 'RepoDigests': [recovery.canonical_digest(self.manifest['publicImages'][0]['reference'])]}
            return {'Id': self.image}
        with patch.object(recovery.subprocess, 'Popen', side_effect=[Unpack(), Unpack()]), \
             patch.object(recovery, 'run', side_effect=execute), patch.object(recovery, 'inspect_image', side_effect=inspected):
            recovery.restore_images(self.directory, self.manifest)
        tags = [args[-1] for args in calls if 'tag' in args]
        self.assertEqual(set(tags), {'system_bootstrapper', 'controller:retained', 'nginx:retained'})

    def test_timed_out_archive_load_kills_and_reaps_both_children(self):
        children = []
        class Process:
            def __init__(self, hanging):
                self.stdout = __import__('io').BytesIO(b'archive')
                self.hanging, self.killed, self.waited = hanging, False, False
            def wait(self, timeout=None):
                if self.hanging and not self.killed:
                    raise subprocess.TimeoutExpired('docker', timeout)
                self.waited = True
                return -9 if self.killed else 0
            def poll(self):
                return -9 if self.killed else None
            def kill(self):
                self.killed = True
        def child(*args, **kwargs):
            value = Process(hanging=len(children) == 1)
            children.append(value)
            return value
        with patch.object(recovery.subprocess, 'Popen', side_effect=child):
            with self.assertRaisesRegex(recovery.RecoveryError, 'archive-load-timeout'):
                recovery.restore_images(self.directory, self.manifest)
        self.assertTrue(all(value.killed and value.waited for value in children))

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
            runtime.verify_images(runtime_config, self.manifest, services)
        self.assertEqual((config.read_bytes(), self.path.read_bytes()), before)

        # Matching the default tag does not relax the declared exact image ID.
        def retargeted(selected):
            return {'Id': 'sha256:' + 'f' * 64} if selected == 'nginx' else inspect(selected)
        with patch.object(runtime.recovery, 'inspect_image', side_effect=retargeted):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'image-alias-retargeted'):
                runtime.verify_images(runtime_config, self.manifest, services)

        services['system_web_1']['Image'] = 'sha256:' + 'f' * 64
        with patch.object(runtime.recovery, 'inspect_image', side_effect=inspect):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'service-image-selection-mismatch'):
                runtime.verify_images(runtime_config, self.manifest, services)

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
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-runtime-proof-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = {'_root': self.root, '_main': self.root / 'configuration/.docker.env',
                       'GITLAB_RUNNER_SCALE': '1', 'GITLAB_HOST': 'gitlab.example.invalid',
                       'GITLAB_DOMAIN_MODE': '2', 'GITLAB_REGISTRY_HOST': 'registry.example.invalid',
                       'GITLAB_REGISTRY_DOMAIN_MODE': '2', 'WIZARD_ENABLE': 'true',
                       'WIZARD_HOST': 'wizard.example.invalid', 'WIZARD_DOMAIN_MODE': '2'}
        self.services = {'system_wizard_1': {'NetworkSettings': {'Networks': {'system_default': {'IPAddress': '172.19.0.3'}}}}}
        self.baseline = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}

    def test_missing_GitLab_data_mount_is_not_masked_by_other_persistent_mounts(self):
        mount = self.root / 'mounted'
        root, seed = mount / 'platform', mount / 'seed'
        for path in (root / 'gitlab/config', root / 'gitlab/logs', seed):
            path.mkdir(parents=True, exist_ok=True)
        config = dict(self.config, _root=root, PERSISTENT_MOUNT=str(mount), SEED_DIR=str(seed))
        gitlab = {'Mounts': [
            {'Type': 'bind', 'Source': str(root / 'gitlab/config'), 'Destination': '/etc/gitlab'},
            {'Type': 'bind', 'Source': str(root / 'gitlab/logs'), 'Destination': '/var/log/gitlab'},
            {'Type': 'bind', 'Source': str(seed), 'Destination': '/seed'}]}
        with patch.object(runtime, 'run', return_value=b'8:1'):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'essential-persistent-mount-missing'):
                runtime.verify_mounts(config, {'system_gitlab_1': gitlab})

    def test_named_volume_cannot_redirect_an_essential_mount_within_the_data_root(self):
        mount = self.root / 'mounted'
        root, seed = mount / 'platform', mount / 'seed'
        for path in (root / 'gitlab/config', root / 'gitlab/logs', root / 'gitlab/data', seed):
            path.mkdir(parents=True, exist_ok=True)
        config = dict(self.config, _root=root, PERSISTENT_MOUNT=str(mount), SEED_DIR=str(seed))
        gitlab = {'Mounts': [
            {'Type': 'volume', 'Name': 'misdirected', 'Source': '/docker/volume', 'Destination': '/etc/gitlab'},
            {'Type': 'bind', 'Source': str(root / 'gitlab/logs'), 'Destination': '/var/log/gitlab'},
            {'Type': 'bind', 'Source': str(root / 'gitlab/data'), 'Destination': '/var/opt/gitlab'},
            {'Type': 'bind', 'Source': str(seed), 'Destination': '/seed'}]}
        def execute(args, **kwargs):
            if 'volume' in args:
                return json.dumps([{'Options': {'type': 'none', 'o': 'bind', 'device': str(root / 'gitlab/logs')}}]).encode()
            return b'8:1'
        with patch.object(runtime, 'run', side_effect=execute):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'essential-persistent-mount-is-misdirected'):
                runtime.verify_mounts(config, {'system_gitlab_1': gitlab})

    def test_readiness_budget_caps_blocking_commands(self):
        runtime.recovery.OPERATION_DEADLINE = __import__('time').monotonic() + 0.02
        try:
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'command-failed'):
                runtime.run(['python3', '-c', 'import time;time.sleep(2)'])
        finally:
            runtime.recovery.OPERATION_DEADLINE = None

    def test_example_configuration_preserves_exact_cube(self):
        raw = (ROOT / 'system/.docker.env.example').read_bytes()
        runtime.cube(raw)
        with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'cube'):
            runtime.cube(raw.replace(b'#$ ', b'#  ', 1))

    def test_missing_token_is_explicitly_not_an_online_runner_claim(self):
        result = runtime.runner_contacts(self.config, self.baseline, None)
        self.assertFalse(result['checked'])
        self.assertNotIn('online', result)

    def test_runner_online_requires_actual_contact_after_baseline(self):
        identity = self.root / 'runners/runner/1/config/.runner_system_id'
        identity.parent.mkdir(parents=True)
        identity.write_text('synthetic-manager\n')
        token = self.root / 'api-token'
        token.write_text('synthetic-private-token')
        token.chmod(0o600)
        contact = {'status': 'online', 'system_id': 'synthetic-manager', 'contacted_at': '2000-01-01T00:00:00Z'}
        def api(url, body=None, headers=None):
            self.assertEqual(headers['PRIVATE-TOKEN'], 'synthetic-private-token')
            result = [{'id': 3}] if '/runners/all?' in url else [contact]
            return 200, json.dumps(result).encode(), {}
        with patch.object(runtime, 'http', side_effect=api):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'contact-not-fresh'):
                runtime.runner_contacts(self.config, self.baseline, token)
            contact['contacted_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            self.assertEqual(runtime.runner_contacts(self.config, self.baseline, token)['online'], 1)
        token.chmod(0o644)
        with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'must-be-private'):
            runtime.runner_contacts(self.config, self.baseline, token)

    def test_container_health_is_insufficient_when_gitlab_http_is_not_ready(self):
        with patch.object(runtime, 'http', return_value=(502, b'', {})):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'gitlab-sign-in-not-ready'):
                runtime.verify_routes(self.config, self.services)

    def test_public_wizard_must_match_its_container_not_gitlab(self):
        def endpoint(url, body=None, headers=None):
            if url.endswith('/v2/'):
                return 401, b'', {'WWW-Authenticate': 'Bearer realm="test"'}
            if url.startswith('http://172.'):
                return 200, b'wizard-content', {}
            return 200, b'gitlab-content', {}
        with patch.object(runtime, 'http', side_effect=endpoint), \
             patch.object(runtime, 'run', return_value=b'{"status":"ok"}'):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'does-not-route-to-wizard'):
                runtime.verify_routes(self.config, self.services)

    def test_authenticated_fetch_compares_exact_saved_bytes(self):
        self.config.update(SYNC_ENABLE='true', SYNC_HOST='sync.example.invalid', SYNC_DOMAIN_MODE='2',
                           SYNC_USER='fixture', SYNC_PASS='synthetic-private-password')
        self.config['_main'].parent.mkdir()
        self.config['_main'].write_bytes(b'original config\n')
        responses = [(200, b'{"refreshToken":"private-refresh"}', {}),
                     (200, b'{"accessToken":"private-access"}', {}),
                     (200, b'{"data":"original config"}', {})]
        with patch.object(runtime, 'http', side_effect=responses):
            with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'does-not-match-saved-config'):
                runtime.verify_sync(self.config)
        responses[-1] = (200, b'{"data":"original config\\n"}', {})
        with patch.object(runtime, 'http', side_effect=responses):
            runtime.verify_sync(self.config)

    def test_private_receipt_does_not_follow_a_symlink(self):
        target = self.root / 'unrelated'
        target.write_text('keep')
        alias = self.root / 'receipt'
        alias.symlink_to(target)
        with self.assertRaisesRegex(runtime.recovery.RecoveryError, 'symlink'):
            runtime.write_private(alias, {'passed': True})
        self.assertEqual(target.read_text(), 'keep')
        result = self.root / 'result.json'
        runtime.write_private(result, {'passed': True})
        self.assertEqual(result.stat().st_mode & 0o777, 0o600)

    def test_absent_volume_blocks_packages_services_and_receipt_creation(self):
        selector = self.root / 'selectors.env'
        data = self.root / 'not-mounted/platform'
        data.parent.mkdir()
        selector.write_text(f'PERSISTENT_MOUNT={data.parent}\nPERSISTENT_DIR={data}\nSEED_DIR={data.parent}/seed\n')
        receipt = self.root / 'operation'
        command = subprocess.run(['bash', str(ROOT / 'bootstrapper/initialize.sh'), '--install-host',
                                  '--receipt-dir', str(receipt)], capture_output=True,
                                 env=dict(os.environ, PERSISTENCE_ENV_FILE=str(selector)))
        self.assertNotEqual(command.returncode, 0)
        self.assertFalse(receipt.exists())
        self.assertFalse(data.exists())

    def test_recovery_rejects_unknown_arguments_before_loading_selectors(self):
        command = subprocess.run(['bash', str(ROOT / 'bootstrapper/recover-volume.sh'), '--unknown'],
                                 capture_output=True, env=dict(os.environ, PERSISTENCE_ENV_FILE='/missing'))
        self.assertNotEqual(command.returncode, 0)
        self.assertIn(b'Usage:', command.stderr)
        self.assertNotIn(b'/missing', command.stderr)

    def test_help_never_needs_live_access(self):
        command = subprocess.run(['bash', str(ROOT / 'bootstrapper/initialize.sh'), '--help'], capture_output=True)
        self.assertEqual(command.returncode, 0)
        self.assertIn(b'No disk formatting or Seed restore', command.stdout)

    def test_cli_error_does_not_dump_private_configuration_or_traceback(self):
        path = self.root / 'selectors.env'
        path.write_text('PERSISTENT_MOUNT=/does-not-exist\nPERSISTENT_DIR=/does-not-exist/data\n'
                        'PERSISTENT_UUID=fixture\nSEED_DIR=/does-not-exist/seed\nSECRET=synthetic-private-secret\n')
        command = subprocess.run(['python3', str(ROOT / 'bootstrapper/verify-runtime.py'), 'baseline',
                                  '--persistence-env', str(path), '--output', str(self.root / 'receipt.json')],
                                 capture_output=True)
        self.assertNotEqual(command.returncode, 0)
        self.assertNotIn(b'synthetic-private-secret', command.stdout + command.stderr)
        self.assertNotIn(b'Traceback', command.stderr)


if __name__ == '__main__':
    unittest.main()
