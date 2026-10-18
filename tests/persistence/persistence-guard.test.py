#!/usr/bin/env python3
"""Host preflight contract; mock only kernel mount discovery, never mount disks."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'bootstrapper/persistence.sh'


class PersistenceGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-storage-guard-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.mount = self.root / 'mounted'
        self.mount.mkdir()
        self.data = self.mount / 'platform'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, PERSISTENT_MOUNT=str(self.mount), PERSISTENT_DIR=str(self.data),
                        PERSISTENT_UUID='expected-uuid', PATH=str(self.bin) + ':' + os.environ['PATH'])
        self.mock('mountpoint', '#!/bin/sh\nexit 0\n')
        self.mock('findmnt', '''#!/bin/sh
for last; do :; done
case "$*" in
 *MAJ:MIN*) if [ "$last" = / ]; then echo root-device; else echo volume-device; fi ;;
 *UUID*) echo expected-uuid ;;
 *) printf '%s\\n' "$PERSISTENT_MOUNT" ;;
esac
''')

    def mock(self, name, content):
        file = self.bin / name
        file.write_text(content)
        file.chmod(0o755)

    def run_guard(self):
        return subprocess.run(['bash', str(SCRIPT)], env=self.env, text=True, capture_output=True)

    def test_absent_mount_fails_before_creating_storage(self):
        self.mock('mountpoint', '#!/bin/sh\nexit 1\n')
        result = self.run_guard()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.data.exists())

    def test_wrong_uuid_fails_before_creating_storage(self):
        self.env['PERSISTENT_UUID'] = 'different'
        self.assertNotEqual(self.run_guard().returncode, 0)
        self.assertFalse(self.data.exists())

    def test_valid_volume_initializes_expected_layout(self):
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.data / 'runners').is_dir())
        self.assertTrue((self.data / 'gitlab/data').is_dir())
        self.assertEqual((self.data / 'configuration').stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.run_guard().returncode, 0)

    def test_escaping_symlink_fails_before_creating_targets(self):
        self.data.mkdir()
        (self.data / 'configuration').symlink_to(self.root / 'outside')
        self.assertNotEqual(self.run_guard().returncode, 0)
        self.assertFalse((self.root / 'outside').exists())

    def test_unknown_marker_fails(self):
        self.data.mkdir()
        (self.data / '.system-bootstrapper-volume').write_text('unknown\n')
        self.assertNotEqual(self.run_guard().returncode, 0)


if __name__ == '__main__':
    unittest.main()
