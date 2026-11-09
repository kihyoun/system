"""Socket-free fresh-host contracts for the real piped Quickstart implementation."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'bootstrapper/quickstart.sh').read_text().split("<<'SYSTEM_QUICKSTART_PY'\n", 1)[1].rsplit('\nSYSTEM_QUICKSTART_PY', 1)[0]
quick = types.ModuleType('system_quickstart')
exec(compile(source, str(ROOT / 'bootstrapper/quickstart.sh'), 'exec'), quick.__dict__)


class Quickstart(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='quickstart-contract-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.installer = b'#!/bin/bash\nset -eu\n# disposable package fixture\n'
        self.selected = {'format': 'system-accepted-release-v1', 'version': '1.0.0', 'tag': 'v1.0.0',
                         'platform': 'linux/amd64',
                         'acceptance': {'controllerWizardSameAttempt': True, 'requiredChecksPassed': True},
                         'source': {'repository': 'https://github.com/kihyoun/system.git',
                                    'revision': 'a' * 40, 'tree': 'b' * 40,
                                    'wizardRepository': 'https://github.com/kihyoun/system-wizard.git',
                                    'wizardRevision': 'c' * 40},
                         'images': {role: {'reference': 'docker.io/example/' + role + '@sha256:' + 'd' * 64}
                                    for role in ('controller', 'wizard')},
                         'quickstart': {'hostInstallerSha256': hashlib.sha256(self.installer).hexdigest()},
                         'documentation': {'quickstart': 'https://github.com/kihyoun/system/blob/v1.0.0/docs/QUICKSTART.md'}}

    def network(self, url):
        self.urls.append(url)
        raw = json.dumps(self.selected).encode()
        name = 'system-release-v1.0.0.json'
        if '/releases/latest' in url or '/releases/tags/' in url:
            return json.dumps({'tag_name': 'v1.0.0', 'draft': False, 'prerelease': False,
                               'assets': [{'name': filename, 'browser_download_url':
                                           'https://github.com/kihyoun/system/releases/download/v1.0.0/' + filename}
                                          for filename in (name, name + '.sha256')]}).encode()
        if url.endswith('.sha256'):
            return (hashlib.sha256(raw).hexdigest() + '  ' + name + '\n').encode()
        if url.endswith('.json'):
            return raw
        if url.endswith('/bootstrapper/install.sh'):
            return self.installer
        raise AssertionError('Unexpected remote: ' + url)

    def test_published_script_is_pinned_even_when_latest_changes(self):
        self.urls = []
        with patch.object(quick, 'ACCEPTED_RELEASE_TAG', 'v1.0.0'), patch.object(quick, 'download', side_effect=self.network):
            self.assertEqual(quick.metadata()['version'], '1.0.0')
        self.assertIn('/releases/tags/v1.0.0', self.urls[0])
        self.assertFalse(any('/releases/latest' in url for url in self.urls))

    def test_metadata_rejects_unaccepted_mutable_foreign_and_mismatched_sources(self):
        for category in ('acceptance', 'source', 'image', 'format', 'version'):
            original = json.loads(json.dumps(self.selected))
            if category == 'acceptance':
                self.selected['acceptance']['requiredChecksPassed'] = False
            elif category == 'source':
                self.selected['source']['repository'] = 'https://attacker.invalid/source.git'
            elif category == 'image':
                self.selected['images']['wizard']['reference'] = 'example/wizard:latest'
            elif category == 'format':
                self.selected['format'] = 'unknown'
            else:
                self.selected['version'] = '2.0.0'
            self.urls = []
            with self.subTest(category=category), patch.object(quick, 'download', side_effect=self.network), self.assertRaises(quick.QuickstartError):
                quick.metadata()
            self.selected = original

    def test_public_redirects_reject_credential_transport_and_non_https(self):
        for value in ('http://github.com/file', 'https://github.com.attacker.invalid/file',
                      'https://user:pass@github.com/file', 'https://github.com:8443/file',
                      'https://127.0.0.1/file', 'file:///etc/passwd'):
            with self.subTest(value=value), self.assertRaises(quick.QuickstartError):
                quick.validate_url(value)

    def test_supported_os_resource_and_existing_state_guards_precede_network_mutations(self):
        fake_os_release = self.directory / 'os-release'
        real_read = Path.read_text
        def read(filename, *args, **kwargs):
            return fake_os_release.read_bytes().decode() if str(filename) == '/etc/os-release' else real_read(filename, *args, **kwargs)
        usage = types.SimpleNamespace(free=100 * 1024 ** 3)
        for version in ('24.04', '26.04'):
            fake_os_release.write_text('ID=ubuntu\nVERSION_ID="' + version + '"\n')
            with patch.object(quick.os, 'geteuid', return_value=0), patch.object(quick.os, 'sysconf', side_effect=[4096, 4 * 1024 ** 2]), \
                    patch.object(quick.platform, 'machine', return_value='x86_64'), patch.object(Path, 'read_text', read), \
                    patch.object(quick.shutil, 'disk_usage', return_value=usage), patch.object(quick.shutil, 'which', return_value=None), \
                    patch.object(Path, 'exists', return_value=False), patch.object(Path, 'is_symlink', return_value=False), \
                    patch.object(quick.socket, 'socket'):
                quick.preflight()
        fake_os_release.write_text('ID=ubuntu\nVERSION_ID="22.04"\n')
        with patch.object(quick.os, 'geteuid', return_value=0), patch.object(Path, 'read_text', read), \
                self.assertRaisesRegex(quick.QuickstartError, '24.04 / 26.04'):
            quick.preflight()
        with patch.object(quick.os, 'geteuid', return_value=1000), self.assertRaisesRegex(quick.QuickstartError, 'sudo/root'):
            quick.preflight()
        fake_os_release.write_text('ID=ubuntu\nVERSION_ID="24.04"\n')
        for fault in ('architecture', 'memory', 'disk', 'existing'):
            with self.subTest(fault=fault), patch.object(quick.os, 'geteuid', return_value=0), \
                    patch.object(Path, 'read_text', read), patch.object(quick.platform, 'machine', return_value='arm64' if fault == 'architecture' else 'x86_64'), \
                    patch.object(quick.os, 'sysconf', side_effect=[4096, 1 if fault == 'memory' else 4 * 1024 ** 2]), \
                    patch.object(quick.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=1 if fault == 'disk' else usage.free)), \
                    patch.object(Path, 'exists', return_value=fault == 'existing'), patch.object(Path, 'is_symlink', return_value=False), \
                    patch.object(quick, 'download') as download, self.assertRaises(quick.QuickstartError):
                quick.install()
            download.assert_not_called()

    def test_memory_preflight_tolerates_only_small_kernel_reservations(self):
        for reported, accepted in [(int(7.75 * 1024 ** 3), True), (int(7.5 * 1024 ** 3), True), (7 * 1024 ** 3, False)]:
            with self.subTest(reported=reported), patch.object(quick.os, 'geteuid', return_value=0), \
                    patch.object(Path, 'read_text', return_value='ID=ubuntu\nVERSION_ID="24.04"\n'), \
                    patch.object(quick.platform, 'machine', return_value='x86_64'), \
                    patch.object(quick.os, 'sysconf', side_effect=[1, reported]), \
                    patch.object(quick.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=100 * 1024 ** 3)), \
                    patch.object(quick.shutil, 'which', return_value=None), \
                    patch.object(Path, 'exists', return_value=False), patch.object(Path, 'is_symlink', return_value=False), \
                    patch.object(quick.socket, 'socket'):
                if accepted:
                    quick.preflight()
                else:
                    with self.assertRaisesRegex(quick.QuickstartError, '7.5 GiB reported'):
                        quick.preflight()

    def test_disposable_fresh_flow_delegates_native_installation_and_passes_exact_manifest(self):
        self.urls, calls = [], []
        checkout = self.directory / 'checkout'
        def command(arguments, timeout=1800):
            calls.append(arguments)
            if arguments[0] == 'bash':
                subprocess.run(arguments, check=True, stdin=subprocess.DEVNULL)
            if 'clone' in arguments:
                checkout.mkdir()
            if arguments[0] == 'python3':
                native = json.loads(Path(arguments[-1]).read_text())
                self.assertEqual(native, self.selected)
                self.assertEqual(Path(arguments[-1]).stat().st_mode & 0o777, 0o600)
        def identity(arguments):
            if 'config' in arguments:
                return (self.selected['source']['wizardRepository'] + '\n').encode()
            return (self.selected['source']['tree'] + '\n').encode() if 'rev-parse' in arguments else \
                ('160000 commit ' + self.selected['source']['wizardRevision'] + '\twizard\n').encode()
        with patch.object(quick, 'preflight'), patch.object(quick, 'CHECKOUT', checkout), \
                patch.object(quick, 'download', side_effect=self.network), patch.object(quick, 'command', side_effect=command), \
                patch.object(quick.subprocess, 'check_output', side_effect=identity), patch.object(quick, 'wait_for_wizard') as ready, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            quick.install()
        ready.assert_called_once()
        native = next(row for row in calls if row[0] == 'python3')
        self.assertIn('--release-metadata', native)
        self.assertIn(self.selected['images']['controller']['reference'], native)
        self.assertIn(self.selected['images']['wizard']['reference'], native)
        self.assertEqual(len([row for row in calls if row[0] == 'bash']), 1)
        self.assertFalse(any('build' in row or 'reset' in row or 'rm' in row for row in calls))
        self.assertIn('http://127.0.0.1:8080/configuration', output.getvalue())
        self.assertIn('sync-auth.env', output.getvalue())
        self.assertNotIn('Password:', output.getvalue())

    def test_checksum_failure_never_executes_native_installer(self):
        self.urls = []
        self.selected['quickstart']['hostInstallerSha256'] = '0' * 64
        with patch.object(quick, 'preflight'), patch.object(quick, 'download', side_effect=self.network), \
                patch.object(quick, 'command') as command, contextlib.redirect_stdout(io.StringIO()), \
                self.assertRaisesRegex(quick.QuickstartError, 'Native host installer source mismatch'):
            quick.install()
        command.assert_not_called()

    def test_pipe_entrypoint_does_not_consume_operator_stdin_or_require_prompts(self):
        # A non-root subprocess executes the actual shell from stdin and reaches
        # the intended privilege refusal, proving the heredoc survives curl|bash.
        capabilities = next((line.split()[1] for line in Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:')), '0')
        if os.geteuid() != 0 or not int(capabilities, 16) & (1 << 7):
            self.skipTest('Dropping only the test subprocess uid requires root/CAP_SETUID')
        result = subprocess.run(['bash'], input=(ROOT / 'bootstrapper/quickstart.sh').read_bytes(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                preexec_fn=lambda: os.setuid(65534), timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b'sudo/root', result.stderr)


if __name__ == '__main__':
    unittest.main()
