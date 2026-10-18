"""Cold-copy/restore regression cases using real rsync and an isolated Docker stub."""
import json
import runpy
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

REPOSITORY = Path(__file__).resolve().parents[2]
DOCKER = '''#!/usr/bin/env python3
import os,sys,pathlib
state=pathlib.Path(os.environ['TEST_STATE']); args=sys.argv[1:]
with (state/'calls').open('a') as f: f.write(' '.join(args)+'\\n')
if args[0]=='info': pass
elif args[0]=='ps': print('fixture-gitlab')
elif args[0]=='inspect':
 field=args[2]
 if 'Running' in field: print((state/'running').read_text())
 elif 'ExitCode' in field: print(os.environ.get('TEST_EXIT','0'))
 elif 'Config.Image' in field: print('gitlab/gitlab-ce:19.4.2-ce.0')
 elif 'Image' in field: print('sha256:fixture-matching-image')
 else: sys.exit(2)
elif args[0]=='image': print(os.environ.get('TEST_IMAGE_ID','sha256:fixture-matching-image'))
elif args[0]=='stop': (state/'running').write_text('false')
elif args[0]=='start': (state/'running').write_text('true')
else: sys.exit(2)
'''
RSYNC = '''#!/usr/bin/env python3
import os,sys
if os.environ.get('FAIL_COPY') and os.environ['FAIL_COPY'] in sys.argv[-1]: sys.exit(12)
os.execv(os.environ['REAL_RSYNC'], ['rsync']+sys.argv[1:])
'''

class RecoveryContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='seed-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['bin', 'seed', 'srv/gitlab/data', 'ssl', 'letsencrypt/renewal']:
            (self.root / name).mkdir(parents=True)
        self.env = {**os.environ, 'PATH': str(self.root/'bin') + os.pathsep + os.environ['PATH'],
                    'GITLAB_IMAGE': 'gitlab/gitlab-ce:19.4.2-ce.0', 'TEST_STATE': str(self.root), 'SEED_ROOT': str(self.root/'seed'),
                    'SERVICE_DATA_DIR': str(self.root/'srv'), 'TLS_DATA_DIR': str(self.root/'ssl'),
                    'LETSENCRYPT_DATA_DIR': str(self.root/'letsencrypt'), 'REAL_RSYNC': shutil.which('rsync')}
        for name, body in [('docker', DOCKER), ('rsync', RSYNC)]:
            (self.root/'bin'/name).write_text(body); (self.root/'bin'/name).chmod(0o755)
        (self.root/'running').write_text('true')
        (self.root/'srv/gitlab/data/identity').write_text('restorable database identity')
        (self.root/'ssl/certificate.pem').write_text('test TLS payload')
        (self.root/'letsencrypt/renewal/example.conf').write_text('test renewal payload')

    def run_script(self, name, success=True, **env):
        result = subprocess.run(['bash', str(REPOSITORY/'system'/f'{name}.sh')], env={**self.env, **env},
                                capture_output=True, text=True, timeout=20)
        if success: self.assertEqual(result.returncode, 0, result.stderr)
        else: self.assertNotEqual(result.returncode, 0, 'operation incorrectly succeeded')
        return result

    def harvest(self):
        self.run_script('harvest')
        return (self.root/'seed/current').resolve()

    def test_completed_cold_copy_captures_renewal_and_preserves_previous_generation(self):
        os.mkfifo(self.root/'srv/gitlab/data/disposable.pipe')
        with socket.socket(socket.AF_UNIX) as endpoint:
            endpoint.bind(str(self.root/'srv/gitlab/data/disposable.socket'))
        (self.root/'seed/srv').mkdir()
        (self.root/'seed/srv/legacy').write_text('historical Seed')
        first = self.harvest()
        manifest = json.loads((first/'manifest.json').read_text())
        self.assertEqual(manifest['consistency'], 'gitlab-stopped')
        self.assertFalse((first/'srv/gitlab/data/disposable.pipe').exists())
        self.assertFalse((first/'srv/gitlab/data/disposable.socket').exists())
        self.assertEqual(manifest['gitlabImage'], 'gitlab/gitlab-ce:19.4.2-ce.0')
        self.assertEqual((first/'letsencrypt/renewal/example.conf').read_text(), 'test renewal payload')
        self.assertEqual((self.root/'running').read_text(), 'true')
        (self.root/'srv/gitlab/data/identity').write_text('second generation')
        second = self.harvest()
        self.assertNotEqual(first, second)
        self.assertEqual((self.root/'seed/srv/legacy').read_text(), 'historical Seed')
        self.assertEqual((first/'srv/gitlab/data/identity').read_text(), 'restorable database identity')
        self.assertFalse((self.root/'seed/.operation-lock').exists())
        self.assertFalse((self.root/'letsencrypt/.system-bootstrapper-certificate-lock').exists())

    def test_incomplete_restore_cannot_be_harvested_as_completed_seed(self):
        (self.root/'srv/gitlab/data/.system-bootstrapper-restore-incomplete').write_text('incomplete')
        self.run_script('harvest', success=False)
        self.assertEqual((self.root/'running').read_text(), 'true')
        self.assertFalse((self.root/'calls').exists())
        self.assertFalse((self.root/'seed/current').exists())

    def test_copy_failure_keeps_current_seed_and_resumes_gitlab(self):
        first = self.harvest()
        self.run_script('harvest', success=False, FAIL_COPY='/ssl/')
        self.assertEqual((self.root/'seed/current').resolve(), first)
        self.assertEqual((self.root/'running').read_text(), 'true')
        self.assertFalse((self.root/'seed/.operation-lock').exists())

    def test_forced_shutdown_is_not_published_as_consistent(self):
        self.run_script('harvest', success=False, TEST_EXIT='137')
        self.assertFalse((self.root/'seed/current').exists())
        self.assertEqual((self.root/'running').read_text(), 'true')

    def test_managed_certificate_renewal_lease_prevents_harvest(self):
        (self.root/'letsencrypt/.system-bootstrapper-certificate-lock').mkdir()
        self.run_script('harvest', success=False)
        self.assertEqual((self.root/'running').read_text(), 'true')
        self.assertFalse((self.root/'calls').exists())

    def test_restore_validates_before_delete_and_recovers_into_empty_new_paths(self):
        self.harvest()
        (self.root/'running').write_text('false')
        for name in ['srv', 'ssl', 'letsencrypt']: shutil.rmtree(self.root/name)
        self.run_script('seed')
        self.assertEqual((self.root/'srv/gitlab/data/identity').read_text(), 'restorable database identity')
        self.assertEqual((self.root/'letsencrypt/renewal/example.conf').read_text(), 'test renewal payload')
        self.assertFalse((self.root/'srv/gitlab/data/.system-bootstrapper-restore-incomplete').exists())

    def test_payload_corruption_and_version_mismatch_rejected_before_delete(self):
        snapshot = self.harvest()
        (self.root/'running').write_text('false')
        self.run_script('seed', success=False, GITLAB_IMAGE='gitlab/gitlab-ce:12.10.6-ce.0')
        self.run_script('seed', success=False, GITLAB_IMAGE='')
        self.run_script('seed', success=False, TEST_IMAGE_ID='sha256:wrong-image')
        (snapshot/'srv/gitlab/data/identity').write_text('corrupted')
        self.run_script('seed', success=False)
        self.assertEqual((self.root/'srv/gitlab/data/identity').read_text(), 'restorable database identity')

    def test_restore_also_respects_managed_renewal_lease(self):
        self.harvest()
        (self.root/'running').write_text('false')
        (self.root/'letsencrypt/.system-bootstrapper-certificate-lock').mkdir()
        self.run_script('seed', success=False)
        self.assertFalse((self.root/'srv/gitlab/data/.system-bootstrapper-restore-incomplete').exists())

    def test_running_gitlab_is_never_overwritten(self):
        self.harvest()
        self.run_script('seed', success=False)

    def test_interrupted_restore_leaves_persistent_startup_guard(self):
        self.harvest()
        (self.root/'running').write_text('false')
        self.run_script('seed', success=False, FAIL_COPY='/ssl/')
        marker = self.root/'srv/gitlab/data/.system-bootstrapper-restore-incomplete'
        self.assertTrue(marker.exists())
        self.run_script('seed')
        self.assertFalse(marker.exists())

    def test_renewal_paths_rebind_without_changing_other_authenticators(self):
        rebind = runpy.run_path(str(REPOSITORY/'bootstrapper/rebind-renewal.py'))['rebind']
        source = '[renewalparams]\nauthenticator = webroot\nwebroot_path = /old/ssl/acme-http01,\n[[webroot_map]]\nexample.test = /old/ssl/acme-http01\n[next_section]\nother = /keep/path\n'
        updated = rebind(source, '/new-volume/platform/ssl/acme-http01')
        self.assertNotIn('/old/', updated)
        self.assertEqual(updated.count('/new-volume/platform/ssl/acme-http01'), 2)
        self.assertIn('other = /keep/path', updated)
        dns = source.replace('authenticator = webroot', 'authenticator = dns-example')
        self.assertEqual(rebind(dns, '/new-volume/ssl'), dns)

    def test_legacy_unmarked_seed_is_rejected_and_absent_seed_is_noop(self):
        self.run_script('seed')
        (self.root/'seed/srv').mkdir(); (self.root/'seed/ssl').mkdir()
        self.run_script('seed', success=False)
        self.assertEqual((self.root/'srv/gitlab/data/identity').read_text(), 'restorable database identity')

if __name__ == '__main__': unittest.main()
