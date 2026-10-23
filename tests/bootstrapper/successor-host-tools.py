#!/usr/bin/env python3
"""Release, cold maintenance, abort and offline successor recovery contracts."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import signal
import time
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bootstrapper'))
import successor


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bootstrapper' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


promoter = module('controller_promoter', 'promote-controller.py')
exporter = module('recovery_exporter', 'record-recovery-images.py')


def fixture():
    release = {'format': 'system-successor-release-v1', 'sourceRevision': 'a' * 40, 'sourceTree': 'b' * 40,
               'wizardRevision': 'c' * 40, 'projectId': 4, 'pipelineId': 17, 'candidateJobId': 29,
               'imageId': 'sha256:' + 'd' * 64, 'registryRepository': 'registry.example.invalid/platform/system/successor',
               'registryReference': 'registry.example.invalid/platform/system/successor@sha256:' + 'e' * 64,
               'candidateEvidencePath': successor.EVIDENCE_PATH}
    security = {'fromImage': 'gitlab/gitlab-ce:old@sha256:' + '1' * 64,
                'toImage': 'gitlab/gitlab-ce:new@sha256:' + '2' * 64, 'fromVersion': 'old'}
    upgrade = {'fromImage': security['fromImage'], 'toImage': security['toImage'],
               'fromImageId': 'sha256:' + '3' * 64, 'toImageId': 'sha256:' + '4' * 64,
               'checkpointVerified': True, 'migrationVerified': True, 'registryVerified': True, 'rollbackVerified': True}
    evidence = {'runId': 'f' * 24, 'sourceRevision': release['sourceRevision'], 'fullAcceptance': True,
                'results': [{'name': stage, 'status': 'passed'} for stage in sorted(successor.STAGES)],
                'images': {'candidate': release['imageId'], 'gitlab': upgrade['toImageId']},
                'evidence': {'gitlabUpgrade': upgrade}}
    evidence_bytes = json.dumps(evidence).encode()
    release['candidateEvidenceSha256'] = hashlib.sha256(evidence_bytes).hexdigest()
    return release, evidence, security


class API:
    base = 'https://gitlab.example.invalid'
    token = 'synthetic-private-token'
    def __init__(self, release, evidence):
        self.release, self.evidence = copy.deepcopy(release), copy.deepcopy(evidence)
        self.project = {'default_branch': 'main', 'container_registry_image_prefix': release['registryRepository'].rsplit('/', 1)[0],
                        'only_allow_merge_if_pipeline_succeeds': True}
        self.branch = {'commit': {'id': release['sourceRevision']}, 'protected': True}
        self.pipeline = {'sha': release['sourceRevision'], 'ref': 'main', 'status': 'success', 'source': 'push'}
        names = list(successor.REQUIRED_JOBS) + ['test:isolated: [' + name + ']' for name in successor.COMPONENTS]
        self.jobs = [{'id': (release['candidateJobId'] if name == 'test:platform-candidate' else index + 100),
                      'name': name, 'status': 'success', 'allow_failure': False,
                      'pipeline': {'id': release['pipelineId']}} for index, name in enumerate(names)]
    def get(self, path):
        if '/repository/branches/' in path:
            return self.branch
        return self.pipeline if '/pipelines/' in path else self.project
    def pages(self, path):
        return self.jobs
    def raw(self, path):
        value = self.evidence if path.endswith(successor.EVIDENCE_PATH) else self.release
        return json.dumps(value).encode(), {}


class ReleaseContracts(unittest.TestCase):
    def setUp(self):
        self.release, self.evidence, self.security = fixture()
        self.api = API(self.release, self.evidence)
        self.release_bytes, self.evidence_bytes = json.dumps(self.release).encode(), json.dumps(self.evidence).encode()
    def verify(self):
        return successor.verify_pipeline(self.api, self.release, self.release_bytes, self.evidence_bytes)
    def test_accepted_source_pipeline_artifacts_and_all_internal_jobs_are_bound(self):
        successor.release_inputs(self.release_bytes, self.evidence_bytes, self.security)
        self.assertEqual(self.verify()['requiredJobsPassed'], 13)
    def test_pipeline_running_or_changed_default_branch_is_rejected(self):
        self.api.pipeline['status'] = 'running'
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-complete'):
            self.verify()
        self.api.pipeline['status'] = 'success'
        self.api.branch['commit']['id'] = 'f' * 40
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'branch-advanced'):
            self.verify()
    def test_internal_job_cannot_be_skipped_or_allowed_to_fail(self):
        self.api.jobs[0]['status'] = 'skipped'
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'required-job-not-successful'):
            self.verify()
        self.api.jobs[0]['status'], self.api.jobs[0]['allow_failure'] = 'success', True
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'required-job-not-successful'):
            self.verify()
    def test_only_the_existing_optional_GitHub_mirror_failure_is_accepted(self):
        self.api.pipeline['status'] = 'failed'
        self.api.jobs.append({'name': 'deploy:github', 'status': 'failed', 'allow_failure': False})
        self.assertTrue(self.verify()['GitHubMirrorFailed'])
        self.api.jobs[-1]['name'] = 'another-failed-job'
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'internal-pipeline-failed'):
            self.verify()
    def test_source_branch_must_remain_protected_and_merge_gate_enabled(self):
        self.api.branch['protected'] = False
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-protected'):
            self.verify()
        self.api.branch['protected'] = True
        self.api.project['only_allow_merge_if_pipeline_succeeds'] = False
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'merge-gate-disabled'):
            self.verify()
    def test_CI_artifact_bytes_cannot_be_replaced_by_local_claims(self):
        self.api.evidence['fullAcceptance'] = False
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'match-CI-artifacts'):
            self.verify()
    def test_frozen_evidence_path_image_and_stages_are_required(self):
        value = copy.deepcopy(self.release)
        value['candidateEvidencePath'] = 'test-results/e2e/old/results.json'
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'hash-or-path'):
            successor.release_inputs(json.dumps(value).encode(), self.evidence_bytes, self.security)
        value = copy.deepcopy(self.evidence)
        value['results'].pop()
        raw = json.dumps(value).encode()
        release = copy.deepcopy(self.release)
        release['candidateEvidenceSha256'] = hashlib.sha256(raw).hexdigest()
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'required-migration-stage-missing'):
            successor.release_inputs(json.dumps(release).encode(), raw, self.security)
    def test_controller_pin_is_an_offline_alias_and_only_intended_assignment_changes(self):
        raw = (ROOT / 'system/.docker.env.example').read_bytes() + b'\n\n'
        alias = successor.controller_alias(self.release)
        updated = successor.assignment(raw, 'BOOTSTRAPPER_IMAGE', alias)
        self.assertEqual(updated[:len(raw)], raw)
        self.assertIn(alias.encode(), updated)
        self.assertEqual(updated[:1184], raw[:1184])
        self.assertEqual(successor.assignment(updated, 'BOOTSTRAPPER_IMAGE', alias), updated)
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'assignment'):
            successor.assignment(raw, 'BOOTSTRAPPER_IMAGE', self.release['registryReference'])
    def test_old_Sync_cannot_claim_project_quiescence_by_omission(self):
        config = {'SYNC_HOST': 'sync.example.invalid', 'SYNC_DOMAIN_MODE': '2', 'SYNC_USER': 'fixture', 'SYNC_PASS': 'fixture'}
        with patch.object(successor.runtime, 'http', side_effect=[(200, b'{"accessToken":"private"}', {}),
                          (200, b'{"needRestart":false,"runnerSetupInProgress":false}', {})]):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'versioned-quiescence-bridge-required'):
                successor.sync_idle(config)


class ColdMaintenanceContracts(unittest.TestCase):
    def setUp(self):
        self.commands = []
        def row(name, service):
            return {'Id': name, 'Image': 'old-image', 'Name': name,
                    'State': {'Running': True, 'Paused': False, 'ExitCode': 0, 'OOMKilled': False},
                    'HostConfig': {'RestartPolicy': {'Name': 'always'}}, 'ExecIDs': [],
                    'Config': {'Labels': {'com.docker.compose.project': 'system', 'com.docker.compose.service': service}}}
        self.controller, self.gitlab, self.web, self.runner = row('controller', 'bootstrapper'), row('gitlab', 'gitlab'), row('web', 'web'), row('runner', 'docker_1')
        self.rows = {row['Id']: row for row in (self.controller, self.gitlab, self.web, self.runner)}
        self.proof = {'runningJobs': 0}
        probe = patch.object(promoter, 'gitlab_probe', side_effect=lambda *args: self.proof)
        probe.start()
        self.addCleanup(probe.stop)
        self.maintenance = promoter.ColdMaintenance({}, self.controller, self.gitlab, self.web, [self.runner], Path('/not-used'), 'accepted-image')
    def run_command(self, args, **kwargs):
        words = args[2:]
        self.commands.append(words)
        if words[0] == 'update':
            self.rows[words[-1]]['HostConfig']['RestartPolicy']['Name'] = words[1].split('=', 1)[1]
        elif words[0] == 'stop':
            self.rows[words[-1]]['State']['Running'] = False
        elif words[0] == 'pause':
            self.rows[words[-1]]['State']['Paused'] = True
        elif words[0] == 'unpause':
            self.rows[words[-1]]['State']['Paused'] = False
        elif words[0] == 'start':
            self.rows[words[-1]]['State']['Running'] = True
        elif words[0] == 'kill':
            self.rows[words[-1]]['State'].update(Running=False, Paused=False, ExitCode=137)
        return b''
    def test_legacy_order_freezes_control_then_cleanly_stops_GitLab_before_checkpoint(self):
        def drain():
            self.commands.append(['drain'])
        with patch.object(promoter, 'run', side_effect=self.run_command), \
             patch.object(promoter, 'inspect', side_effect=lambda name: self.rows[name]), \
             patch.object(self.maintenance, 'drain', side_effect=drain), \
             patch.object(promoter, 'checkpoint_copy', side_effect=lambda *args: self.commands.append(['checkpoint']) or 'digest'):
            self.assertEqual(self.maintenance.run(), 'digest')
        self.assertEqual([row[0] for row in self.commands],
                         ['update', 'stop', 'pause', 'drain', 'exec', 'stop', 'exec', 'exec', 'drain', 'stop', 'kill', 'checkpoint'])
        self.assertFalse(any('unpause' in row for row in self.commands))
        self.assertFalse(self.controller['State']['Running'])
    def test_job_claim_after_first_preflight_resumes_without_killing_running_jobs(self):
        self.proof['runningJobs'] = 1
        with patch.object(promoter, 'run', side_effect=self.run_command), \
             patch.object(promoter, 'inspect', side_effect=lambda name: self.rows[name]), \
             patch.object(self.maintenance, 'drain'), patch.object(promoter, 'checkpoint_copy') as copied:
            with self.assertRaisesRegex(promoter.ActiveJobs, 'old-generation-resumed'):
                self.maintenance.run()
            copied.assert_not_called()
        self.assertTrue(self.runner['State']['Running'])
        self.assertTrue(self.gitlab['State']['Running'])
        self.assertTrue(self.web['State']['Running'])
        self.assertTrue(self.controller['State']['Running'])
        self.assertFalse(self.controller['State']['Paused'])
        self.assertEqual(self.controller['HostConfig']['RestartPolicy']['Name'], 'always')
        self.assertFalse(any(row[0] == 'kill' for row in self.commands))

    def test_expired_remote_stop_budget_never_reaches_unbounded_timeout_zero(self):
        for value in (promoter.SCHEDULING_STOP, promoter.ALL_SERVICES_STOP):
            controlled_clock = value.replace('read -r uptime rest </proc/uptime', 'uptime=10')
            result = subprocess.run(['/bin/sh', '-ec', controlled_clock, 'sh', '10'], capture_output=True)
            self.assertEqual(result.returncode, 124, result.stderr)

    def test_remote_stop_scripts_parse_in_actual_POSIX_shell(self):
        for value in (promoter.SCHEDULING_STOP, promoter.SCHEDULING_START,
                      promoter.ALL_SERVICES_STOP, promoter.ALL_SERVICES_DOWN):
            result = subprocess.run(['/bin/sh', '-n', '-c', value], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_uncertain_GitLab_service_stop_cannot_reach_kill_or_checkpoint(self):
        def operation(args, **kwargs):
            if promoter.ALL_SERVICES_STOP in args:
                raise successor.recovery.RecoveryError('synthetic-stop-timeout')
            return self.run_command(args, **kwargs)
        with patch.object(promoter, 'run', side_effect=operation), \
             patch.object(promoter, 'inspect', side_effect=lambda name: self.rows[name]), \
             patch.object(self.maintenance, 'drain'), patch.object(promoter, 'checkpoint_copy') as copied:
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'stop-timeout'):
                self.maintenance.run()
            copied.assert_not_called()
        self.assertTrue(self.controller['State']['Paused'])
        self.assertFalse(any(row[0] == 'kill' for row in self.commands))
    def test_unfinished_remote_execs_fail_with_bounded_drain(self):
        self.gitlab['ExecIDs'] = ['pending-exec']
        with patch.object(promoter, 'inspect', return_value=self.gitlab), \
             patch.object(promoter.time, 'monotonic', side_effect=[0, 1, 1000]), patch.object(promoter.time, 'sleep'):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'exec-drain-timeout'):
                self.maintenance.drain()
    def test_old_GitLab_forced_stop_is_not_a_completed_checkpoint(self):
        def operation(args, **kwargs):
            result = self.run_command(args, **kwargs)
            if args[2:3] == ['stop'] and args[-1] == 'gitlab':
                self.gitlab['State']['ExitCode'] = 137
            return result
        with patch.object(promoter, 'run', side_effect=operation), \
             patch.object(promoter, 'inspect', side_effect=lambda name: self.rows[name]), \
             patch.object(self.maintenance, 'drain'), patch.object(promoter, 'checkpoint_copy') as copied:
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-clean'):
                self.maintenance.run()
            copied.assert_not_called()
    def test_live_owner_refusal_precedes_checkpoint_helper_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = (ROOT / 'system/.docker.env.example').read_bytes()
            main = root / 'main.env'
            main.write_bytes(raw)
            main.chmod(0o600)
            successor.atomic_bytes(root / 'main-before.env', raw)
            successor.atomic_json(root / 'copy-helper.json', {'name': 'owned-running-copy', 'owner': 'owned-running-copy'})
            record = {'format': 'system-controller-promotion-v1', 'phase': 'cold-maintenance-started',
                      'leaseOperation': 'fixture', 'release': fixture()[0],
                      'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
                      'configurationAfterSha256': 'f' * 64, 'oldGitLab': {'imageId': 'old-image'},
                      'previousController': {'imageId': 'previous-controller'}}
            successor.atomic_json(root / 'operation.json', record)
            with patch.object(successor, 'verify_checkout'), \
                 patch.object(promoter, 'inspect', return_value=self.gitlab), \
                 patch.object(successor.recovery, 'inspect_image', return_value={'Id': 'previous-controller'}), \
                 patch.object(successor.Lease, 'adopt', side_effect=successor.recovery.RecoveryError('coordinator-still-running')), \
                 patch.object(promoter, 'run') as mutations:
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'still-running'):
                    promoter.abort_promotion({'_main': main}, root)
                mutations.assert_not_called()

    def test_abort_refuses_a_changed_GitLab_image_even_when_controller_can_be_reverted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main = root / 'main.env'
            raw = (ROOT / 'system/.docker.env.example').read_bytes()
            main.write_bytes(raw)
            main.chmod(0o600)
            before = root / 'main-before.env'
            before.write_bytes(raw)
            before.chmod(0o600)
            record = {'format': 'system-controller-promotion-v1', 'phase': 'controller-start-started',
                      'leaseOperation': 'fixture', 'release': fixture()[0],
                      'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
                      'configurationAfterSha256': 'f' * 64, 'oldGitLab': {'imageId': 'old-image'}}
            successor.atomic_json(root / 'operation.json', record)
            config = {'_main': main}
            self.gitlab['Image'] = 'new-migrated-image'
            with patch.object(successor, 'verify_checkout'), patch.object(promoter, 'inspect', return_value=self.gitlab):
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'refuses-GitLab-image-change'):
                    promoter.abort_promotion(config, root)


class HostChildInterruption(unittest.TestCase):
    def test_successful_leader_cannot_leave_a_live_grandchild_after_guard_release(self):
        with tempfile.TemporaryDirectory(prefix='system-host-grandchild-') as directory:
            root = Path(directory)
            for path in (root / 'platform/configuration/.projects.env', root / 'platform/host/letsencrypt', root / 'seed'):
                path.mkdir(parents=True)
            config = {'_root': root / 'platform', 'SEED_DIR': str(root / 'seed')}
            code = ('import subprocess,sys; child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"],'
                    'stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(child.pid,flush=True)')
            with successor.Lease(config):
                pid = int(successor.run([sys.executable, '-c', code]).decode().strip())
                self.assertIsNone(successor.process_start(pid))
            self.assertIsNone(successor.ACTIVE_LEASE)

    def test_SIGKILL_parent_cannot_release_guard_while_owned_command_survives(self):
        with tempfile.TemporaryDirectory(prefix='system-host-child-') as directory:
            root = Path(directory)
            for path in (root / 'platform/configuration/.projects.env', root / 'platform/host/letsencrypt', root / 'seed'):
                path.mkdir(parents=True)
            parent = subprocess.Popen([sys.executable, __file__, '--watchdog-parent', str(root)],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            config = {'_root': root / 'platform', 'SEED_DIR': str(root / 'seed')}
            journal = config['_root'] / 'configuration/.gitlab-upgrade-lock/host-child.json'
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if journal.exists():
                    child = json.loads(journal.read_bytes())
                    if child.get('phase') == 'running':
                        break
                time.sleep(0.02)
            else:
                parent.kill()
                output, error = parent.communicate(timeout=5)
                self.fail('Owned command never reached its journaled start barrier: ' + error.decode())
            os.kill(parent.pid, signal.SIGKILL)
            parent.communicate(timeout=5)
            self.assertEqual(successor.process_start(child['childPid']), child['childStart'])
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'still-running'):
                successor.Lease.adopt(config, child['operation'])
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                final = json.loads(journal.read_bytes())
                if final.get('phase') == 'completed' and successor.process_start(child['guardianPid']) != child['guardianStart']:
                    break
                time.sleep(0.05)
            else:
                self.fail('Owned guardian did not finish its bounded command group.')
            lease = successor.Lease.adopt(config, child['operation'])
            lease.release()
            self.assertFalse(journal.parent.exists())
            self.assertTrue((config['_root'] / 'configuration/.controller-host-guard.lock').is_file())


class ExportContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-successor-export-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.release, self.evidence, _ = fixture()
        self.old_id, self.wizard_id = 'sha256:' + '7' * 64, 'sha256:' + '8' * 64
        self.wizard_ref = 'registry.example.invalid/platform/wizard@sha256:' + '9' * 64
        self.old = {'archives': [{'file': 'images/old.tar.gz', 'imageId': self.old_id},
                                 {'file': 'images/wizard.tar.gz', 'imageId': self.wizard_id, 'imageRef': self.wizard_ref}],
                    'localImages': [{'tag': 'system_bootstrapper', 'imageId': self.old_id},
                                    {'tag': 'controller:old', 'imageId': self.old_id}],
                    'publicImages': [{'reference': 'gitlab/gitlab-ce:old@sha256:' + '1' * 64,
                                      'tag': 'gitlab/gitlab-ce:old', 'imageId': 'sha256:' + '3' * 64}],
                    'currentController': {'reference': 'controller:old', 'imageId': self.old_id}}
        self.alias = successor.controller_alias(self.release)
    def refreshed(self):
        source = tuple(self.release[key] for key in ('sourceRevision', 'sourceTree', 'wizardRevision'))
        archive = {'file': 'images/new.tar.gz', 'imageId': self.release['imageId']}
        return exporter.refreshed_manifest(self.old, archive, source, self.alias, self.release['imageId'],
                                            self.evidence['evidence']['gitlabUpgrade']['toImage'],
                                            self.evidence['images']['gitlab'], self.wizard_ref)
    def test_new_manifest_preserves_Wizard_and_old_accepted_archives_and_versioned_alias(self):
        value = self.refreshed()
        self.assertEqual(value['archives'][1], self.old['archives'][1])
        self.assertEqual(value['currentController']['productionWizardReference'], self.wizard_ref)
        aliases = {row['tag']: row['imageId'] for row in value['localImages']}
        self.assertEqual(aliases['controller:old'], self.old_id)
        self.assertEqual(aliases['system_bootstrapper'], self.release['imageId'])
        self.assertEqual(aliases[self.alias], self.release['imageId'])
        self.assertFalse(any('@' in row['tag'] for row in value['localImages']))
        self.assertEqual(value['controllerHistory'][0], self.old['currentController'])
    def test_archive_restore_can_start_new_controller_without_own_registry(self):
        value, calls = self.refreshed(), []
        aliases = {row['tag']: row['imageId'] for row in value['localImages']}
        public = value['publicImages'][0]
        class Process:
            def __init__(self):
                self.stdout = io.BytesIO(b'archive')
            def wait(self, timeout=None):
                return 0
            def poll(self):
                return 0
        def image(reference):
            if reference in aliases:
                return {'Id': aliases[reference]}
            if reference == public['reference']:
                return {'Id': public['imageId'], 'RepoDigests': [successor.recovery.canonical_digest(reference)]}
            return {'Id': reference}
        with patch.object(successor.recovery.subprocess, 'Popen', side_effect=lambda *args, **kwargs: Process()), \
             patch.object(successor.recovery, 'inspect_image', side_effect=image), \
             patch.object(successor.recovery, 'run', side_effect=lambda args, **kwargs: calls.append(args) or b''):
            successor.recovery.restore_images(self.root, value)
        self.assertFalse(any('pull' in call and any('registry.example.invalid' in word for word in call) for call in calls))
        self.assertTrue(any(call[-1] == self.alias and 'tag' in call for call in calls))
        aliases[self.alias] = 'sha256:' + '0' * 64
        with patch.object(successor.recovery.subprocess, 'Popen', side_effect=lambda *args, **kwargs: Process()), \
             patch.object(successor.recovery, 'inspect_image', side_effect=image), \
             patch.object(successor.recovery, 'run', return_value=b''):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'local-image-alias-mismatch'):
                successor.recovery.restore_images(self.root, value)
    def test_invalid_candidate_manifest_does_not_change_active_bytes_or_checksum(self):
        original = b'{  "original":true }\n\n'
        (self.root / 'images.json').write_bytes(original)
        with patch.object(successor.recovery, 'load_manifest', side_effect=successor.recovery.RecoveryError('invalid-candidate')):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'invalid-candidate'):
                exporter.publish_manifest(self.root, {}, self.root, self.root / 'settings.env', original)
        self.assertEqual((self.root / 'images.json').read_bytes(), original)
        self.assertEqual(hashlib.sha256((self.root / 'images.json').read_bytes()).digest(), hashlib.sha256(original).digest())
        self.assertFalse((self.root / 'manifest-history').exists())

    def test_candidate_validation_precedes_atomic_publication_and_history_is_exact(self):
        original = b'{  "original":true }\n\n'
        (self.root / 'images.json').write_bytes(original)
        def validate(*args, **kwargs):
            self.assertEqual((self.root / 'images.json').read_bytes(), original)
            self.assertEqual(json.loads(kwargs['manifest_bytes']), {'accepted': True})
        with patch.object(successor.recovery, 'load_manifest', side_effect=validate), \
             patch.object(successor.recovery, 'validate_selected_images'):
            exporter.publish_manifest(self.root, {'accepted': True}, self.root, self.root / 'settings.env', original)
        history = self.root / 'manifest-history' / ('images-' + hashlib.sha256(original).hexdigest() + '.json')
        self.assertEqual(history.read_bytes(), original)
        self.assertEqual(json.loads((self.root / 'images.json').read_bytes()), {'accepted': True})

    def test_interrupted_archive_publication_does_not_prevent_a_new_attempt(self):
        (self.root / 'images').mkdir()
        class Process:
            def __init__(self):
                self.stdout = io.BytesIO(b'fixture image bytes')
            def wait(self, timeout=None):
                return 0
            def poll(self):
                return 0
        source = (self.release['sourceRevision'], self.release['sourceTree'], self.release['wizardRevision'])
        with patch.object(exporter.subprocess, 'Popen', side_effect=lambda *args, **kwargs: Process()):
            first = exporter.save_archive(self.root, self.alias, self.release['imageId'], source)
            second = exporter.save_archive(self.root, self.alias, self.release['imageId'], source)
        self.assertNotEqual(first['file'], second['file'])
        self.assertTrue((self.root / first['file']).is_file())
        self.assertTrue((self.root / second['file']).is_file())
    def test_hanging_image_save_is_killed_and_reaped_before_leases_can_be_released(self):
        (self.root / 'images').mkdir()
        real_popen, real_timer = subprocess.Popen, threading.Timer
        processes = []
        def process(*args, **kwargs):
            value = real_popen(['python3', '-c', 'import sys,time;sys.stdout.write("x");sys.stdout.flush();time.sleep(30)'],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            processes.append(value)
            return value
        source = (self.release['sourceRevision'], self.release['sourceTree'], self.release['wizardRevision'])
        with patch.object(exporter.subprocess, 'Popen', side_effect=process), \
             patch.object(exporter.threading, 'Timer', side_effect=lambda seconds, callback: real_timer(0.05, callback)):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'archive-failed-or-timed-out'):
                exporter.save_archive(self.root, self.alias, self.release['imageId'], source)
        self.assertIsNotNone(processes[0].poll())
        self.assertFalse(list((self.root / 'images').iterdir()))


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--watchdog-parent':
        root = Path(sys.argv[2])
        config = {'_root': root / 'platform', 'SEED_DIR': str(root / 'seed')}
        with successor.Lease(config) as lease:
            lease.critical = True
            successor.run([sys.executable, '-c', 'import time;time.sleep(1.5)'])
    else:
        unittest.main()
