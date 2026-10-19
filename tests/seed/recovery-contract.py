"""Cold-copy/restore regression cases using real rsync and an isolated Docker stub."""
import json
import runpy
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

REPOSITORY = Path(__file__).resolve().parents[2]
DOCKER = '''#!/usr/bin/env python3
import os,sys,pathlib,time,subprocess
state=pathlib.Path(os.environ['TEST_STATE']); args=sys.argv[1:]
with (state/'calls').open('a') as f: f.write(' '.join(args)+'\\n')
if args[0]=='info': pass
elif args[0]=='ps': print('fixture-gitlab')
elif args[0]=='inspect':
 field=args[2]
 if 'Running' in field and 'ExitCode' in field and 'OOMKilled' in field:
  if os.environ.get('TEST_STATE_MALFORMED'): print('private malformed state');sys.exit(0)
  print((state/'running').read_text(),os.environ.get('TEST_EXIT','0'),os.environ.get('TEST_OOM','false'))
 elif 'Running' in field: print((state/'running').read_text())
 elif 'ExitCode' in field: print(os.environ.get('TEST_EXIT','0'))
 elif 'Config.Image' in field: print('gitlab/gitlab-ce:19.4.2-ce.0')
 elif 'Image' in field: print('sha256:fixture-matching-image')
 else: sys.exit(2)
elif args[0]=='image': print(os.environ.get('TEST_IMAGE_ID','sha256:fixture-matching-image'))
elif args[0]=='exec':
 if any('harvest-quiesce-exit:' in arg for arg in args):
  if os.environ.get('TEST_BAD_QUIESCE_RESPONSE'):
   result=subprocess.run(['/bin/sh','-ec',args[-3],'sh',args[-1]],capture_output=True,text=True)
   clock=pathlib.Path(os.environ['TEST_MONOTONIC_FILE'])
   temporary=clock.with_suffix('.next');temporary.write_text('100108.00 0.00\\n');os.replace(temporary,clock)
   (state/'bad-response-issued').touch()
   print(os.environ['TEST_BAD_QUIESCE_RESPONSE'])
   sys.exit(0)
  sys.exit(subprocess.run(['/bin/sh','-ec',args[-3],'sh',args[-1]]).returncode)
 elif '/sv status' in args[-1] or '/sv u' in args[-1]:
  program=args[-1].replace('/opt/gitlab/service',str(state/'sv-services')).replace('/opt/gitlab/embedded/bin/sv',str(state/'bin/sv'))
  sys.exit(subprocess.run(['/bin/sh','-ec',program]).returncode)
 else: sys.exit(2)
elif args[0]=='stop':
 time.sleep(float(os.environ.get('TEST_DOCKER_STOP_DELAY','0')))
 (state/'running').write_text('false')
elif args[0]=='start':
 (state/'running').write_text('true')
 (state/'service-state').write_text('running')
else: sys.exit(2)
'''
GITLAB_CTL = '''#!/usr/bin/env python3
import os,sys,pathlib,time
state=pathlib.Path(os.environ['TEST_STATE'])
if sys.argv[1]!='stop': sys.exit(2)
(state/'service-state').write_text('partial')
time.sleep(float(os.environ.get('TEST_QUIESCE_DELAY','0')))
print('private service output must not escape')
result=int(os.environ.get('TEST_QUIESCE_EXIT','0'))
if result: sys.exit(result)
(state/'service-state').write_text('running' if os.environ.get('TEST_SERVICES_STILL_RUNNING') else 'down')
'''
SV = '''#!/usr/bin/env python3
import os,sys,pathlib
state=pathlib.Path(os.environ['TEST_STATE'])
if sys.argv[1]=='status':
 if os.environ.get('TEST_DOWN_PROOF_EXIT'): sys.exit(1)
 if os.environ.get('TEST_DOWN_PROOF_MALFORMED'): print('private malformed service proof')
 else: print(('down: ' if (state/'service-state').read_text()=='down' else 'run: ')+sys.argv[2]+': 0s')
elif sys.argv[1]=='u':
 with (state/'up-calls').open('a') as f: f.write(sys.argv[2]+'\\n')
 if os.environ.get('TEST_RESUME_FAIL'): sys.exit(1)
 (state/'service-state').write_text('running')
 (state/'services-resumed').write_text('true')
else: sys.exit(2)
'''
TIMEOUT = '''#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
if os.environ.get('TEST_SHORT_QUIESCE_TIMEOUT') and 'gitlab-ctl' in args and args[-1]=='stop':
 # Run the real timeout/process-group cleanup with a short fixture deadline.
 # Keep every original timeout argument in the separate invocation receipt.
 with open(os.path.join(os.environ['TEST_STATE'],'timeout-requests'),'a') as f: f.write(' '.join(args)+'\\n')
 args[2]='0.15'
os.execv(os.environ['REAL_TIMEOUT'],['timeout']+args)
'''
RSYNC = '''#!/usr/bin/env python3
import os,sys
if os.environ.get('FAIL_COPY') and os.environ['FAIL_COPY'] in sys.argv[-1]: sys.exit(12)
os.execv(os.environ['REAL_RSYNC'], ['rsync']+sys.argv[1:])
'''

NODE = '''#!/usr/bin/env python3
import os,sys
if len(sys.argv)>2 and sys.argv[1].endswith('seed-manifest.js') and sys.argv[2]==os.environ.get('FAIL_MANIFEST'):
 print('private injected manifest failure',file=sys.stderr);sys.exit(19)
os.execv(os.environ['REAL_NODE'], ['node']+sys.argv[1:])
'''

class RecoveryContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='seed-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['bin', 'seed', 'srv/gitlab/data', 'ssl', 'letsencrypt/renewal', 'sv-services', 'sv-target']:
            (self.root / name).mkdir(parents=True)
        self.env = {**os.environ, 'PATH': str(self.root/'bin') + os.pathsep + os.environ['PATH'],
                    'GITLAB_IMAGE': 'gitlab/gitlab-ce:19.4.2-ce.0', 'TEST_STATE': str(self.root), 'SEED_ROOT': str(self.root/'seed'),
                    'SERVICE_DATA_DIR': str(self.root/'srv'), 'TLS_DATA_DIR': str(self.root/'ssl'),
                    'LETSENCRYPT_DATA_DIR': str(self.root/'letsencrypt'), 'REAL_RSYNC': shutil.which('rsync'), 'REAL_NODE': shutil.which('node'),
                    'REAL_TIMEOUT': shutil.which('timeout')}
        for name, body in [('docker', DOCKER), ('rsync', RSYNC), ('node', NODE), ('timeout', TIMEOUT), ('sv', SV), ('gitlab-ctl', GITLAB_CTL)]:
            (self.root/'bin'/name).write_text(body); (self.root/'bin'/name).chmod(0o755)
        (self.root/'running').write_text('true')
        (self.root/'service-state').write_text('running')
        for service in ['postgresql', 'redis']:
            (self.root/'sv-services'/service).symlink_to(self.root/'sv-target', target_is_directory=True)
        (self.root/'srv/gitlab/data/identity').write_text('restorable database identity')
        (self.root/'ssl/certificate.pem').write_text('test TLS payload')
        (self.root/'letsencrypt/renewal/example.conf').write_text('test renewal payload')

    def run_script(self, name, success=True, script=None, **env):
        result = subprocess.run(['bash', str(script or REPOSITORY/'system'/f'{name}.sh')], env={**self.env, **env},
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

    def test_cold_harvest_failure_phases_preserve_exit_resume_locks_and_previous_snapshot(self):
        first = self.harvest()
        failures = [({'FAIL_COPY': '/' + name + '/'}, phase, 12)
                    for name, phase in [('srv', 'srv-copy'), ('ssl', 'ssl-copy'), ('letsencrypt', 'certbot-copy')]]
        failures += [({'FAIL_MANIFEST': command}, phase, 19)
                     for command, phase in [('create', 'manifest-create'), ('publish', 'snapshot-publish')]]
        for environment, phase, code in failures:
            with self.subTest(phase=phase):
                result = self.run_script('harvest', success=False, **environment)
                self.assertEqual(result.returncode, code)
                self.assertIn('Harvest phase failed: ' + phase + '.', result.stderr)
                self.assertEqual((self.root/'seed/current').resolve(), first)
                self.assertEqual((self.root/'running').read_text(), 'true')
                self.assertFalse((self.root/'seed/.operation-lock').exists())
                self.assertFalse((self.root/'letsencrypt/.system-bootstrapper-certificate-lock').exists())

    def test_forced_shutdown_is_not_published_as_consistent(self):
        for code in ['1', '137', '139', '143']:
            with self.subTest(exit_code=code):
                result = self.run_script('harvest', success=False, TEST_EXIT=code)
                self.assertIn('Harvest phase failed: gitlab-clean-exit.', result.stderr)
                self.assertIn(f'running=false exitCode={code} oomKilled=false.', result.stderr)
                self.assertFalse((self.root/'seed/current').exists())
                self.assertEqual((self.root/'running').read_text(), 'true')

    def test_service_quiescence_is_proved_before_docker_stop_inside_the_shared_budget(self):
        self.harvest()
        calls=(self.root/'calls').read_text()
        quiesce=calls.index('exec --env SVWAIT=90 system_gitlab_1')
        verified=calls.index('/sv status')
        stopped=calls.index('stop --time')
        self.assertLess(quiesce, verified)
        self.assertLess(verified, stopped)
        stop_line=next(line for line in calls.splitlines() if line.startswith('stop --time'))
        self.assertGreater(int(stop_line.split()[2]), 0)
        self.assertLess(int(stop_line.split()[2]), 120)

    def test_nonzero_quiesce_resumes_partial_services_without_docker_stop_or_seed_change(self):
        first=self.harvest()
        (self.root/'calls').write_text('')
        result=self.run_script('harvest',success=False,TEST_QUIESCE_EXIT='7')
        self.assertEqual(result.returncode,7)
        self.assertIn('Harvest phase failed: gitlab-quiesce.', result.stderr)
        self.assertNotIn('private service output',result.stderr+result.stdout)
        self.assertEqual((self.root/'seed/current').resolve(),first)
        self.assertEqual((self.root/'service-state').read_text(),'running')
        self.assertEqual((self.root/'services-resumed').read_text(),'true')
        self.assertNotIn('stop --time',(self.root/'calls').read_text())
        self.assertNotIn('\nstart ',(self.root/'calls').read_text())
        self.assertFalse((self.root/'seed/.operation-lock').exists())
        self.assertFalse((self.root/'letsencrypt/.system-bootstrapper-certificate-lock').exists())

    def test_real_quiesce_timeout_resumes_partial_services_and_keeps_previous_seed(self):
        first=self.harvest()
        result=self.run_script('harvest',success=False,TEST_SHORT_QUIESCE_TIMEOUT='1',TEST_QUIESCE_DELAY='2')
        self.assertEqual(result.returncode,124)
        self.assertIn('Harvest phase failed: gitlab-quiesce.',result.stderr)
        self.assertEqual((self.root/'seed/current').resolve(),first)
        self.assertEqual((self.root/'service-state').read_text(),'running')
        self.assertEqual((self.root/'services-resumed').read_text(),'true')
        self.assertIn('gitlab-ctl stop',(self.root/'timeout-requests').read_text())
        self.assertFalse((self.root/'seed/.operation-lock').exists())
        self.assertFalse((self.root/'letsencrypt/.system-bootstrapper-certificate-lock').exists())

    def test_zero_quiesce_exit_cannot_hide_a_still_running_service(self):
        result=self.run_script('harvest',success=False,TEST_SERVICES_STILL_RUNNING='1')
        self.assertIn('Harvest phase failed: gitlab-services-down.',result.stderr)
        self.assertFalse((self.root/'seed/current').exists())
        self.assertEqual((self.root/'service-state').read_text(),'running')
        self.assertNotIn('stop --time',(self.root/'calls').read_text())

    def test_malformed_or_failed_service_proof_and_empty_service_set_are_rejected(self):
        for setting in ['TEST_DOWN_PROOF_MALFORMED','TEST_DOWN_PROOF_EXIT']:
            with self.subTest(setting=setting):
                result=self.run_script('harvest',success=False,TEST_EXIT='143',**{setting:'1'})
                self.assertIn('Harvest phase failed: gitlab-services-down.',result.stderr)
                self.assertNotIn('private malformed',result.stdout+result.stderr)
                self.assertFalse((self.root/'seed/current').exists())
                self.assertEqual((self.root/'service-state').read_text(),'running')
        for service in (self.root/'sv-services').iterdir(): service.unlink()
        result=self.run_script('harvest',success=False,TEST_EXIT='143')
        self.assertIn('Harvest phase failed: gitlab-services-down.',result.stderr)
        self.assertFalse((self.root/'seed/current').exists())

    def test_malformed_container_state_is_not_a_clean_shutdown_proof(self):
        result=self.run_script('harvest',success=False,TEST_STATE_MALFORMED='1')
        self.assertIn('Harvest phase failed: gitlab-stopped-check.',result.stderr)
        self.assertIn('Harvest GitLab state: unavailable.',result.stderr)
        self.assertNotIn('private malformed',result.stdout+result.stderr)
        self.assertFalse((self.root/'seed/current').exists())

    def test_malformed_completion_does_not_bypass_the_remote_deadline_before_resuming(self):
        first=self.harvest()
        clock=self.root/'monotonic-uptime'
        clock.write_text('100000.00 0.00\n')
        # Rebind only the kernel clock input. Execute the actual script with its
        # full production deadline arithmetic, response validation and cleanup.
        program=self.root/'harvest-clock-fixture.sh'
        program.write_text((REPOSITORY/'system/harvest.sh').read_text().replace('/proc/uptime',str(clock)))
        advanced=self.root/'clock-advanced'
        stop=threading.Event()
        def advance():
            while not stop.wait(0.01):
                if (self.root/'bad-response-issued').exists():
                    time.sleep(0.25)
                    temporary=clock.with_suffix('.advance')
                    temporary.write_text('100111.00 0.00\n');os.replace(temporary,clock)
                    advanced.touch()
                    return
        timer=threading.Thread(target=advance,daemon=True);timer.start()
        started=time.monotonic()
        try:
            result=self.run_script('harvest',success=False,script=program,TEST_BAD_QUIESCE_RESPONSE='harvest-quiesce-exit:000',TEST_MONOTONIC_FILE=str(clock))
        finally:
            stop.set();timer.join(timeout=2)
        self.assertEqual(result.returncode,1)
        self.assertIn('Harvest phase failed: gitlab-quiesce.',result.stderr)
        self.assertNotIn('harvest-quiesce-exit:000',result.stdout+result.stderr)
        self.assertGreaterEqual(time.monotonic()-started,0.8)
        self.assertTrue(advanced.exists())
        self.assertGreaterEqual((self.root/'services-resumed').stat().st_mtime_ns,advanced.stat().st_mtime_ns)
        self.assertEqual((self.root/'seed/current').resolve(),first)
        self.assertEqual((self.root/'service-state').read_text(),'running')
        self.assertFalse((self.root/'seed/.operation-lock').exists())
        self.assertFalse((self.root/'letsencrypt/.system-bootstrapper-certificate-lock').exists())

    def test_failed_partial_stop_resumption_is_reported_without_hiding_the_primary_failure(self):
        result=self.run_script('harvest',success=False,TEST_QUIESCE_EXIT='7',TEST_RESUME_FAIL='1')
        self.assertEqual(result.returncode,7)
        self.assertIn('GitLab restart failed after Harvest.',result.stderr)
        self.assertFalse((self.root/'seed/current').exists())
        self.assertEqual(len((self.root/'up-calls').read_text().splitlines()),2)

    def test_oom_is_rejected_even_with_zero_container_exit(self):
        for code in ['0','143']:
            with self.subTest(exit_code=code):
                result=self.run_script('harvest',success=False,TEST_EXIT=code,TEST_OOM='true')
                self.assertIn('Harvest phase failed: gitlab-clean-exit.',result.stderr)
                self.assertIn(f'running=false exitCode={code} oomKilled=true.',result.stderr)
                self.assertFalse((self.root/'seed/current').exists())

    def test_already_stopped_unclean_container_is_not_started_or_harvested(self):
        for code,oom in [('137','false'),('143','false'),('0','true')]:
            with self.subTest(exit_code=code,oom=oom):
                (self.root/'running').write_text('false')
                (self.root/'calls').write_text('')
                result=self.run_script('harvest',success=False,TEST_EXIT=code,TEST_OOM=oom)
                self.assertIn('Harvest phase failed: gitlab-clean-exit.',result.stderr)
                self.assertFalse((self.root/'seed/current').exists())
                self.assertEqual((self.root/'running').read_text(),'false')
                self.assertNotIn('exec ',(self.root/'calls').read_text())
                self.assertNotIn('start ',(self.root/'calls').read_text())

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
