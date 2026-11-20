#!/usr/bin/env python3
"""Release, cold maintenance, abort and offline successor recovery contracts."""
import copy
from contextlib import ExitStack
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


def process_start(pid):
    try:
        fields = Path('/proc/' + str(pid) + '/stat').read_text().rpartition(')')[2].split()
        return None if fields[0] == 'Z' else fields[19]
    except (FileNotFoundError, IndexError):
        return None


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bootstrapper' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


promoter = module('controller_promoter', 'promote-controller.py')


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
                'evidence': {'gitlabUpgrade': upgrade,
                             'storage': {key: True for key in successor.STORAGE_PROOFS}}}
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
        names = list(successor.REQUIRED_JOBS) + ['test:codeql'] + ['test:isolated: [' + name + ']' for name in successor.COMPONENTS]
        self.jobs = [{'id': (release['candidateJobId'] if name == 'test:platform-candidate' else index + 100),
                      'name': name, 'status': 'success', 'allow_failure': False,
                      'pipeline': {'id': release['pipelineId']}} for index, name in enumerate(names)]
        self.artifacts = {}
    def get(self, path):
        if '/repository/branches/' in path:
            return self.branch
        return self.pipeline if '/pipelines/' in path else self.project
    def pages(self, path):
        return self.jobs
    def raw(self, path):
        if path in self.artifacts:
            value = self.artifacts[path]
            return (value if isinstance(value, bytes) else json.dumps(value).encode()), {}
        value = self.evidence if path.endswith(successor.EVIDENCE_PATH) else self.release
        return json.dumps(value).encode(), {}


def public_pair(release, evidence, api):
    release.update(wizardImageId='sha256:' + '8' * 64,
                   wizardRegistryReference=release['registryRepository'] + '-wizard@sha256:' + '9' * 64)
    evidence['images']['wizard'] = release['wizardImageId']
    release['candidateEvidenceSha256'] = hashlib.sha256(json.dumps(evidence).encode()).hexdigest()
    api.release, api.evidence = copy.deepcopy(release), copy.deepcopy(evidence)
    for number, name in [(900, 'test:wizard-browser'), (901, 'deploy:dockerhub'), (902, 'deploy:github')]:
        api.jobs.append({'id': number, 'name': name, 'status': 'success', 'allow_failure': False,
                         'pipeline': {'id': release['pipelineId']}, 'commit': {'id': release['sourceRevision']}})
    controller = 'docker.io/example/system@' + release['registryReference'].split('@')[1]
    wizard = 'docker.io/example/wizard@' + release['wizardRegistryReference'].split('@')[1]
    public = {'format': 'system-public-release-v1', 'publicationJobId': 901, 'versionTag': None,
              'platform': 'linux/amd64', **{key: release[key] for key in
                ('projectId', 'pipelineId', 'sourceRevision', 'sourceTree', 'wizardRevision')},
              'upstreamRelease': {key: release[key] for key in
                ('projectId', 'pipelineId', 'candidateJobId', 'registryReference', 'candidateEvidenceSha256')}}
    for role, reference, image, revision in [('controller', controller, release['imageId'], release['sourceRevision']),
                                           ('wizard', wizard, release['wizardImageId'], release['wizardRevision'])]:
        public[role] = {'reference': reference.removeprefix('docker.io/'), 'imageId': image, 'sourceRevision': revision,
                        'configDigest': 'sha256:' + '1' * 64}
    source = {'format': 'system-wizard-source-publication-v1', 'projectId': release['projectId'],
              'pipelineId': release['pipelineId'], 'publicationJobId': 902,
              'systemRevision': release['sourceRevision'], 'wizardRevision': release['wizardRevision'],
              'repository': 'https://github.com/example/wizard.git',
              'ref': 'refs/heads/system-release/' + release['wizardRevision']}
    prefix = '/projects/' + str(release['projectId'])
    api.artifacts[prefix + '/jobs/901/artifacts/test-results/dockerhub/release.json'] = public
    api.artifacts[prefix + '/jobs/902/artifacts/test-results/github/wizard-source.json'] = source
    api.artifacts[prefix + '/repository/files/.gitmodules/raw?ref=' + release['sourceRevision']] = (
        b'[submodule "wizard"]\n\tpath = wizard\n\turl = https://github.com/example/wizard.git\n')
    return controller, wizard, public, source


class PublicPairContracts(unittest.TestCase):
    def setUp(self):
        self.release, self.evidence, self.security = fixture()
        self.api = API(self.release, self.evidence)
        self.controller, self.wizard, self.public, self.source = public_pair(self.release, self.evidence, self.api)

    def verify(self):
        successor.release_inputs(json.dumps(self.release).encode(), json.dumps(self.evidence).encode(), self.security)
        successor.verify_pipeline(self.api, self.release, json.dumps(self.release).encode(), json.dumps(self.evidence).encode())
        return successor.verify_public_pair(self.api, self.release, self.evidence, self.controller, self.wizard)

    def test_public_pair_binds_same_candidate_source_and_public_dependency(self):
        proof = self.verify()
        self.assertEqual(proof['jobId'], 901)
        self.assertEqual(proof['sourceJobId'], 902)

    def test_Wizard_image_and_internal_registry_are_independently_bound(self):
        for change in [dict(wizardImageId='sha256:' + '0' * 64),
                       dict(wizardRegistryReference='registry.example.invalid/other@sha256:' + '9' * 64),
                       dict(wizardRegistryReference=None)]:
            with self.subTest(change=change), self.assertRaisesRegex(successor.recovery.RecoveryError, 'Wizard-release-evidence'):
                successor.wizard_release(dict(self.release, **change), self.evidence)

    def test_native_push_and_both_required_publication_jobs_are_required(self):
        for source in ['web', 'schedule', 'api', 'merge_request_event']:
            self.api.pipeline['source'] = source
            with self.subTest(source=source), self.assertRaises(successor.recovery.RecoveryError): self.verify()
        self.api.pipeline['source'] = 'push'
        for name in ['deploy:dockerhub', 'deploy:github']:
            job = next(row for row in self.api.jobs if row['name'] == name)
            for key, value in [('status', 'failed'), ('allow_failure', True), ('commit', {'id': '0' * 40}),
                               ('pipeline', {'id': 900})]:
                old = job[key]; job[key] = value
                with self.subTest(name=name, key=key), self.assertRaises(successor.recovery.RecoveryError): self.verify()
                job[key] = old

    def test_paired_browser_job_must_exist_and_pass_for_the_same_source_pipeline(self):
        browser = next(job for job in self.api.jobs if job['name'] == 'test:wizard-browser')
        self.api.jobs.remove(browser)
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'paired-Wizard-browser-job'):
            self.verify()
        self.api.jobs.append(browser)
        for key, value in [('status', 'skipped'), ('status', 'failed'), ('allow_failure', True),
                           ('pipeline', {'id': 900}), ('commit', {'id': '0' * 40})]:
            old = browser[key]; browser[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(successor.recovery.RecoveryError):
                self.verify()
            browser[key] = old
        self.assertEqual(self.verify()['jobId'], 901)

    def test_public_artifact_cannot_claim_another_source_image_or_candidate(self):
        changes = [('sourceRevision', '0' * 40), ('wizardRevision', '0' * 40), ('publicationJobId', 900),
                   ('upstreamRelease', dict(self.public['upstreamRelease'], candidateJobId=900)),
                   ('wizard', dict(self.public['wizard'], reference=self.controller)),
                   ('wizard', dict(self.public['wizard'], imageId='sha256:' + '0' * 64)),
                   ('controller', dict(self.public['controller'], sourceRevision='0' * 40))]
        for key, value in changes:
            old = self.public[key]; self.public[key] = value
            with self.subTest(key=key), self.assertRaises(successor.recovery.RecoveryError): self.verify()
            self.public[key] = old

    def test_public_dependency_must_match_authenticated_gitmodules_and_retained_ref(self):
        for key, value in [('repository', 'https://github.com/another/wizard.git'), ('ref', 'refs/heads/master'),
                           ('wizardRevision', '0' * 40), ('publicationJobId', 900), ('systemRevision', '0' * 40)]:
            old = self.source[key]; self.source[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(successor.recovery.RecoveryError, 'source-publication-mismatch'):
                self.verify()
            self.source[key] = old


class ReleaseContracts(unittest.TestCase):
    def setUp(self):
        self.release, self.evidence, self.security = fixture()
        self.api = API(self.release, self.evidence)
        self.release_bytes, self.evidence_bytes = json.dumps(self.release).encode(), json.dumps(self.evidence).encode()
    def verify(self):
        return successor.verify_pipeline(self.api, self.release, self.release_bytes, self.evidence_bytes)
    def test_accepted_source_pipeline_artifacts_and_all_internal_jobs_are_bound(self):
        successor.release_inputs(self.release_bytes, self.evidence_bytes, self.security)
        self.assertEqual(self.verify()['requiredJobsPassed'], 14)
    def test_each_storage_acceptance_proof_is_required_before_promotion(self):
        for key in successor.STORAGE_PROOFS:
            with self.subTest(key=key):
                evidence = copy.deepcopy(self.evidence)
                evidence['evidence']['storage'][key] = False
                raw = json.dumps(evidence).encode()
                release = copy.deepcopy(self.release)
                release['candidateEvidenceSha256'] = hashlib.sha256(raw).hexdigest()
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'storage-acceptance-required'):
                    successor.release_inputs(json.dumps(release).encode(), raw, self.security)
    def test_codeql_is_required_for_new_promotion_but_old_receipts_remain_recoverable(self):
        job = next(row for row in self.api.jobs if row['name'] == 'test:codeql')
        self.api.jobs.remove(job)
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'required-job-not-successful'):
            self.verify()
        historical = successor._verify_pipeline(self.api, self.release, self.release_bytes, self.evidence_bytes, current=False)
        self.assertEqual(historical['requiredJobsPassed'], 13)
        self.api.jobs.append(job)
        historical = successor._verify_pipeline(self.api, self.release, self.release_bytes, self.evidence_bytes, current=False)
        self.assertEqual(historical['requiredJobsPassed'], 14)
        job['status'] = 'skipped'
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'required-job-not-successful'):
            successor._verify_pipeline(self.api, self.release, self.release_bytes, self.evidence_bytes, current=False)
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

    def test_runner_security_profile_requires_real_upgrade_and_manager_identity_evidence(self):
        security = copy.deepcopy(self.security)
        security.update(runner={'toVersion': '19.5.1', 'toImage': 'runner:fixed', 'helperImage': 'helper:fixed'}, jobCaBundleSha256='9' * 64)
        evidence = copy.deepcopy(self.evidence)
        evidence['images']['runner'] = 'sha256:' + '5' * 64
        evidence['results'].append({'name': 'gitlab-upgrade-security-trust', 'status': 'passed'})
        evidence['evidence']['gitlabUpgrade'].update(runnerImage='runner:fixed', runnerImageId=evidence['images']['runner'],
            runnerVersion='19.5.1', helperImage='helper:fixed', helperImageId='sha256:' + '6' * 64,
            fromRunnerImageId='sha256:' + '7' * 64, fromHelperImageId='sha256:' + '8' * 64,
            jobCaBundleSha256=security['jobCaBundleSha256'],
            securityTrustVerified=True, runnerUpgradeVerified=True, runnerManagerIdentityPreserved=True)
        def verify(value):
            raw = json.dumps(value).encode()
            release = dict(self.release, candidateEvidenceSha256=hashlib.sha256(raw).hexdigest())
            successor.release_inputs(json.dumps(release).encode(), raw, security)
        verify(evidence)
        for key in ('runnerUpgradeVerified', 'runnerManagerIdentityPreserved', 'securityTrustVerified',
                    'fromRunnerImageId', 'fromHelperImageId', 'helperImageId', 'jobCaBundleSha256'):
            invalid = copy.deepcopy(evidence)
            invalid['evidence']['gitlabUpgrade'].pop(key)
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'runner-security-evidence-mismatch'):
                verify(invalid)
        proof = evidence['evidence']['gitlabUpgrade']
        for old, current in [('fromRunnerImageId', 'runnerImageId'), ('fromHelperImageId', 'helperImageId')]:
            with self.subTest(key=old):
                before = proof[old]
                proof[old] = proof[current]
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'runner-security-evidence-mismatch'):
                    verify(evidence)
                proof[old] = before
    def test_old_Sync_cannot_claim_project_quiescence_by_omission(self):
        config = {'SYNC_HOST': 'sync.example.invalid', 'SYNC_DOMAIN_MODE': '2', 'SYNC_USER': 'fixture', 'SYNC_PASS': 'fixture'}
        with patch.object(successor.runtime, 'http', side_effect=[(200, b'{"accessToken":"private"}', {}),
                          (200, b'{"needRestart":false,"runnerSetupInProgress":false}', {})]):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'versioned-quiescence-bridge-required'):
                successor.sync_idle(config)


class StagedControllerContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-staged-controller-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.release, self.evidence, self.security = fixture()
        self.api = API(self.release, self.evidence)
        self.alias = successor.controller_alias(self.release)
        self.checkpoint = self.root / 'recovery/controller-promotions/prior'
        self.checkpoint.mkdir(parents=True)
        (self.root / 'configuration').mkdir()
        raw = (ROOT / 'system/.docker.env.example').read_bytes().replace(b'export WIZARD_ENABLE=true', b'export WIZARD_ENABLE=false')
        raw += ("\nexport BOOTSTRAPPER_IMAGE='controller:old'\nexport NGINX_IMAGE='nginx:retained'\n"
                "export GITLAB_RUNNER_IMAGE='runner:retained'\nexport GITLAB_IMAGE='" + self.security['fromImage'] + "'\n").encode()
        self.before = raw
        self.current = successor.assignment(raw, 'BOOTSTRAPPER_IMAGE', self.alias)
        self.config = {'_root': self.root, '_main': self.root / 'configuration/.docker.env',
                       'BOOTSTRAPPER_IMAGE': self.alias, 'GITLAB_HOST': 'gitlab.example.invalid', 'GITLAB_DOMAIN_MODE': '2',
                       'PERSISTENT_MOUNT': str(self.root.parent), 'PERSISTENT_UUID': 'fixture', 'SEED_DIR': str(self.root / 'seed')}
        successor.atomic_bytes(self.config['_main'], self.current)
        successor.atomic_bytes(self.root / 'configuration/sync-auth.env', b'export SYNC_USER=fixture\n')
        successor.atomic_bytes(self.checkpoint / 'main-before.env', raw)
        self.manifest = {'sourceCommit': '1' * 40, 'localImages': [{'tag': 'controller:old', 'imageId': 'sha256:' + '7' * 64},
                                       {'tag': 'runner:retained', 'imageId': 'sha256:' + '8' * 64}],
                         'publicImages': [{'reference': self.security['fromImage'], 'tag': 'gitlab/gitlab-ce:old'},
                                          {'reference': 'nginx@sha256:' + '9' * 64, 'tag': 'nginx:retained'}],
                         'currentController': {'reference': 'controller:old', 'imageId': 'sha256:' + '7' * 64}}
        self.manifest_bytes = json.dumps(self.manifest).encode()
        successor.atomic_bytes(self.root / 'recovery/images.json', self.manifest_bytes)
        successor.atomic_bytes(self.checkpoint / 'manifest-before.json', self.manifest_bytes)
        for name in ('gitlab', 'configuration'):
            (self.checkpoint / name).mkdir()
            (self.checkpoint / name / 'data').write_bytes(b'original durable bytes')
        successor.atomic_controller_checkpoint(self.checkpoint / 'cold-checkpoint.json', {
            'format': 'system-controller-cold-checkpoint-v1',
            'entries': {name: promoter.inventory(self.checkpoint / name) for name in ('gitlab', 'configuration')}})
        self.record = {'format': 'system-controller-promotion-v1',
                       'phase': 'controller-promoted-old-GitLab-preserved', 'GitLabMigrationStarted': False,
                       'coldMaintenance': True, 'oldGitLabImagePreserved': True,
                       'configurationChangedOnlyControllerImage': True, 'managerIdentitiesPreserved': True,
                       'release': self.release, 'controllerAlias': self.alias,
                       'pipeline': successor.verify_pipeline(self.api, self.release, json.dumps(self.release).encode(), json.dumps(self.evidence).encode()),
                       'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
                       'configurationAfterSha256': hashlib.sha256(self.current).hexdigest(),
                       'coldCheckpointSha256': successor.recovery.sha(self.checkpoint / 'cold-checkpoint.json'),
                       'newControllerId': 'running-staged-controller',
                       'oldGitLab': {'imageId': self.evidence['evidence']['gitlabUpgrade']['fromImageId']}}
        self.rows = {name: {'Id': identifier, 'Image': image,
                           'State': {'Running': True, 'Paused': False, 'OOMKilled': False, 'StartedAt': 'fixture'},
                           'HostConfig': {'RestartPolicy': {'Name': 'always'}},
                           'Config': {'Labels': {'com.docker.compose.project': 'system', 'com.docker.compose.service': service}}}
                     for name, identifier, image, service in (
                         ('system_bootstrapper_1', 'running-staged-controller', self.release['imageId'], 'bootstrapper'),
                         ('system_web_1', 'running-web', 'sha256:' + '9' * 64, 'web'),
                         ('system_gitlab_1', 'running-old-gitlab', self.record['oldGitLab']['imageId'], 'gitlab'))}
        self.image = {'Id': self.release['imageId'], 'RepoDigests': [self.release['registryReference']],
                      'Config': {'Labels': {'org.opencontainers.image.revision': self.release['sourceRevision'],
                                             'org.system-bootstrapper.test-job': str(self.release['candidateJobId'])}}}
        self.target = copy.deepcopy(self.release)
        self.target.update(sourceRevision='6' * 40, pipelineId=18, candidateJobId=30, imageId='sha256:' + '5' * 64)
        self.api.branch['commit']['id'] = self.target['sourceRevision']
        self.source = patch.object(successor, 'verify_source_objects')
        self.source.start()
        self.addCleanup(self.source.stop)
        ancestry = patch.object(successor, 'verify_ancestry')
        self.ancestry = ancestry.start()
        self.addCleanup(ancestry.stop)
        images = patch.object(successor.recovery, 'inspect_image', side_effect=lambda reference: self.image)
        images.start()
        self.addCleanup(images.stop)
        self.save()

    def save(self):
        successor.atomic_json(self.checkpoint / 'operation.json', self.record)

    def verify(self):
        return promoter.staged_manifest(self.config, self.manifest, self.rows, self.api, self.security, self.checkpoint, self.target)

    def test_completed_staging_authenticates_historical_CI_without_rewriting_recovery(self):
        view, receipt = self.verify()
        self.assertEqual(view['currentController']['imageId'], self.release['imageId'])
        self.assertEqual(self.manifest['currentController']['reference'], 'controller:old')
        self.assertEqual((self.root / 'recovery/images.json').read_bytes(), self.manifest_bytes)
        self.assertEqual(self.config['_main'].read_bytes(), self.current)
        self.assertEqual(receipt['operationSha256'], successor.recovery.sha(self.checkpoint / 'operation.json'))
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'branch-advanced'):
            successor.verify_pipeline(self.api, self.release, json.dumps(self.release).encode(), json.dumps(self.evidence).encode())

    def test_completed_normal_staging_can_be_replaced_again_without_a_new_cold_checkpoint(self):
        self.record['coldMaintenance'] = False
        del self.record['coldCheckpointSha256']
        self.save()
        (self.checkpoint / 'cold-checkpoint.json').unlink()
        self.verify()

    def test_incomplete_or_migrated_promotion_cannot_authorize_an_override(self):
        for key, value in (('phase', 'controller-start-started'), ('GitLabMigrationStarted', True),
                           ('oldGitLabImagePreserved', False), ('managerIdentitiesPreserved', False)):
            previous = self.record[key]
            self.record[key] = value
            self.save()
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'completed-staged'):
                self.verify()
            self.record[key] = previous

    def test_rewritten_or_unrelated_source_history_cannot_authorize_staging(self):
        for outcomes in ([successor.recovery.RecoveryError('source-is-not-descendant')],
                         [None, successor.recovery.RecoveryError('source-is-not-descendant')]):
            self.ancestry.side_effect = outcomes
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-descendant'):
                self.verify()
            self.assertEqual((self.root / 'recovery/images.json').read_bytes(), self.manifest_bytes)

    def test_prior_pipeline_still_requires_protection_merge_gate_jobs_and_original_artifacts(self):
        for owner, key, value, reason in ((self.api.branch, 'protected', False, 'not-protected'),
                (self.api.project, 'only_allow_merge_if_pipeline_succeeds', False, 'merge-gate-disabled'),
                (self.api.jobs[0], 'status', 'skipped', 'required-job-not-successful'),
                (self.api.evidence, 'fullAcceptance', False, 'hash-or-path')):
            previous = owner[key]
            owner[key] = value
            with self.assertRaisesRegex(successor.recovery.RecoveryError, reason):
                self.verify()
            owner[key] = previous

    def test_image_alias_source_job_and_running_container_identity_are_all_required(self):
        for owner, key, value in ((self.image, 'Id', 'sha256:' + '0' * 64),
                (self.image, 'RepoDigests', []),
                (self.image['Config']['Labels'], 'org.opencontainers.image.revision', '0' * 40),
                (self.image['Config']['Labels'], 'org.system-bootstrapper.test-job', '999'),
                (self.rows['system_bootstrapper_1'], 'Id', 'unrecorded-controller'),
                (self.rows['system_bootstrapper_1'], 'Image', 'sha256:' + '0' * 64)):
            previous = owner[key]
            owner[key] = value
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'running-image-mismatch'):
                self.verify()
            owner[key] = previous

    def test_changed_configuration_manifest_old_GitLab_or_checkpoint_is_rejected(self):
        successor.atomic_bytes(self.config['_main'], self.current + b'\n# changed\n')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'configuration-mismatch'):
            self.verify()
        successor.atomic_bytes(self.config['_main'], self.current)
        successor.atomic_bytes(self.root / 'recovery/images.json', self.manifest_bytes + b'\n')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'manifest-changed'):
            self.verify()
        successor.atomic_bytes(self.root / 'recovery/images.json', self.manifest_bytes)
        self.rows['system_gitlab_1']['Image'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'old-GitLab-image-changed'):
            self.verify()
        self.rows['system_gitlab_1']['Image'] = self.record['oldGitLab']['imageId']
        (self.checkpoint / 'gitlab/data').write_bytes(b'corrupted durable bytes')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'checkpoint-content-mismatch'):
            self.verify()

    def test_unrelated_project_or_nonretained_checkpoint_cannot_authorize_staging(self):
        self.target['projectId'] = 99
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'project-mismatch'):
            self.verify()
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'retained-staged'):
            promoter.staged_manifest(self.config, self.manifest, self.rows, self.api, self.security, self.root, self.target)

    def normal_promotion(self, change_manifest=False):
        evidence = copy.deepcopy(self.evidence)
        evidence['sourceRevision'] = self.target['sourceRevision']
        evidence['images']['candidate'] = self.target['imageId']
        self.target['candidateEvidenceSha256'] = hashlib.sha256(json.dumps(evidence).encode()).hexdigest()
        target_api = API(self.target, evidence)
        prior_api = self.api
        class HistoryAPI:
            base = prior_api.base
            def get(self, path):
                return (prior_api if '/pipelines/17' in path else target_api).get(path)
            def pages(self, path):
                return (prior_api if '/pipelines/17/' in path else target_api).pages(path)
            def raw(self, path):
                return (prior_api if '/jobs/29/' in path else target_api).raw(path)
        class Lease:
            operation = 'fixture-lease'
            def __init__(self, config, legacy_controller=None):
                if legacy_controller is not rows['system_bootstrapper_1']:
                    raise AssertionError('promotion must serialize the inspected legacy controller')
            def __enter__(self): return self
            def __exit__(self, *args): return False
        alias = successor.controller_alias(self.target)
        self.config['_persistence_env'] = str(self.root / 'persistence.env')
        rows = self.rows
        self.commands = []
        def command(args, **kwargs):
            self.commands.append(args)
            if 'stop' in args:
                rows['system_bootstrapper_1']['State']['Running'] = False
            if 'compose' in args:
                rows['system_bootstrapper_1'].update(Id='new-tested-controller', Image=self.target['imageId'])
                rows['system_bootstrapper_1']['State']['Running'] = True
            return b''
        def image(reference):
            if reference == self.security['fromImage']:
                return {'Id': self.record['oldGitLab']['imageId'],
                        'RepoDigests': [successor.recovery.canonical_digest(reference)]}
            return {'Id': self.target['imageId']} if reference == alias else self.image
        def selected(config, manifest, services):
            self.assertEqual(manifest['currentController']['imageId'], self.release['imageId'])
        def baseline(*args, **kwargs):
            if change_manifest:
                successor.atomic_bytes(self.root / 'recovery/images.json', self.manifest_bytes + b'\n')
            return {'configurationFiles': {'configuration/.docker.env': hashlib.sha256(self.current).hexdigest()},
                    'manifestSha256': successor.recovery.sha(self.root / 'recovery/images.json')}
        with ExitStack() as stack:
            stack.enter_context(patch.object(successor, 'verify_checkout'))
            stack.enter_context(patch.object(successor, 'Lease', Lease))
            idle = stack.enter_context(patch.object(successor, 'sync_idle'))
            stack.enter_context(patch.object(successor.recovery, 'load_manifest', return_value=self.manifest))
            stack.enter_context(patch.object(successor.recovery, 'inspect_image', side_effect=image))
            self.pulled = stack.enter_context(patch.object(promoter, 'pull_accepted'))
            stack.enter_context(patch.object(promoter, 'gitlab_preflight'))
            stack.enter_context(patch.object(promoter, 'inspect', side_effect=lambda name:
                rows[name] if name in rows else next(row for row in rows.values() if row['Id'] == name)))
            stack.enter_context(patch.object(promoter, 'run', side_effect=command))
            cold = stack.enter_context(patch.object(promoter, 'ColdMaintenance'))
            stack.enter_context(patch.object(promoter, 'wait_for_staged'))
            stack.enter_context(patch.object(successor.runtime, 'inspect_services', return_value=rows))
            stack.enter_context(patch.object(successor.runtime, 'verify_mounts'))
            stack.enter_context(patch.object(successor.runtime, 'verify_images', side_effect=selected))
            capture = stack.enter_context(patch.object(successor.runtime, 'capture', side_effect=baseline))
            stack.enter_context(patch.object(successor.runtime, 'assert_baseline'))
            stack.enter_context(patch.object(successor.runtime, 'settings', return_value=self.config))
            result = promoter.promote(self.config, self.target, evidence, HistoryAPI(),
                json.dumps(self.target).encode(), json.dumps(evidence).encode(), self.security,
                self.root / 'recovery/controller-promotions/next', staged=self.checkpoint)
            cold.assert_not_called()
            self.assertEqual(idle.call_count, 2)
            self.assertEqual(capture.call_args.kwargs['manifest']['currentController']['imageId'], self.release['imageId'])
        return result

    def test_normal_successor_promotion_keeps_old_GitLab_and_original_manifest_without_cold_copy(self):
        result = self.normal_promotion()
        self.assertEqual(result['phase'], 'controller-promoted-old-GitLab-preserved')
        self.assertFalse(result['coldMaintenance'])
        self.assertFalse(result['GitLabMigrationStarted'])
        self.assertEqual(result['previousController']['imageId'], self.release['imageId'])
        self.assertEqual(result['previousStagedPromotion']['sourceRevision'], self.release['sourceRevision'])
        self.assertEqual(self.rows['system_gitlab_1']['Image'], self.record['oldGitLab']['imageId'])
        self.assertEqual(self.config['_main'].read_bytes(), successor.assignment(self.current, 'BOOTSTRAPPER_IMAGE', successor.controller_alias(self.target)))
        self.assertEqual((self.root / 'recovery/images.json').read_bytes(), self.manifest_bytes)
        self.assertFalse((self.root / 'recovery/controller-promotions/next/cold-checkpoint.json').exists())

    def test_manifest_changed_after_binding_cannot_be_legitimized_by_a_new_baseline(self):
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'staged-controller-recovery-manifest-changed'):
            self.normal_promotion(change_manifest=True)
        self.assertEqual(self.config['_main'].read_bytes(), self.current)
        self.assertTrue(self.rows['system_bootstrapper_1']['State']['Running'])
        self.assertFalse(any('stop' in command or 'compose' in command for command in self.commands))

    def test_missing_effective_selection_refuses_before_pull_checkpoint_or_controller_writes(self):
        # The preceding manifest check sees valid retained saved selectors. The
        # actual Compose environment is independently required to preserve them.
        with patch.object(successor, 'environment', return_value={}):
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'image-selection-required'):
                self.normal_promotion()
        self.assertEqual(self.commands, [])
        self.pulled.assert_not_called()
        self.assertEqual(self.config['_main'].read_bytes(), self.current)
        self.assertFalse((self.root / 'recovery/controller-promotions/next').exists())


class EffectivePromotionEnvironment(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='controller-effective-images-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'configuration').mkdir()
        self.main = self.root / 'configuration/.docker.env'
        successor.atomic_bytes(self.root / 'configuration/sync-auth.env', b'export SYNC_USER=fixture\n')
        self.config = {'_root': self.root, '_main': self.main, 'PERSISTENT_MOUNT': '/fixture',
                       'PERSISTENT_UUID': 'fixture', 'SEED_DIR': '/fixture/seed'}
        self.old_gitlab, self.old_runner = 'sha256:' + '1' * 64, 'sha256:' + '2' * 64
        self.evidence = {'evidence': {'gitlabUpgrade': {'fromImageId': self.old_gitlab,
                                                      'fromRunnerImageId': self.old_runner}}}
        self.security = {'runner': {'fromImage': 'runner:reviewed'}}
        self.services = {'system_gitlab_1': {'Image': self.old_gitlab}, 'runner_docker_1': {'Image': self.old_runner}}
        self.images = {'gitlab:retained': {'Id': self.old_gitlab}, 'runner:retained': {'Id': self.old_runner},
                       'gitlab:new-default': {'Id': 'sha256:' + '3' * 64}, 'runner:new-default': {'Id': 'sha256:' + '4' * 64}}
        self.write('export GITLAB_IMAGE=gitlab:retained\nexport GITLAB_RUNNER_IMAGE=runner:retained\n')

    def write(self, assignments):
        successor.atomic_bytes(self.main, (ROOT / 'system/.docker.env.example').read_bytes()[:1184] +
                               b'\n' + assignments.encode())

    def select(self, inherited=None):
        with patch.dict(os.environ, {'PATH': os.environ['PATH'], **(inherited or {})}, clear=True), \
             patch.object(successor.recovery, 'inspect_image', side_effect=lambda selected: self.images[selected]):
            return promoter.preserved_environment(self.config, 'controller:accepted', self.security, self.evidence, self.services)

    def test_saved_aliases_for_exact_old_content_are_preserved(self):
        selected = self.select()
        self.assertEqual(selected['GITLAB_IMAGE'], 'gitlab:retained')
        self.assertEqual(selected['GITLAB_RUNNER_IMAGE'], 'runner:retained')
        self.assertEqual(selected['SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER'], '1')

    def test_explicit_correct_inputs_are_allowed_without_saved_image_assignments(self):
        self.write('')
        selected = self.select({'GITLAB_IMAGE': 'gitlab:retained', 'GITLAB_RUNNER_IMAGE': 'runner:retained'})
        self.assertEqual(selected['GITLAB_RUNNER_IMAGE'], 'runner:retained')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'image-selection-required'):
            self.select()
        self.write('export GITLAB_IMAGE=gitlab:retained\n')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'image-selection-required'):
            self.select()

    def test_saved_wrong_selection_overrides_correct_inherited_input_and_is_refused(self):
        self.write('export GITLAB_IMAGE=gitlab:new-default\nexport GITLAB_RUNNER_IMAGE=runner:retained\n')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'image-selection-changed'):
            self.select({'GITLAB_IMAGE': 'gitlab:retained'})
        self.write('export GITLAB_IMAGE=gitlab:retained\nexport GITLAB_RUNNER_IMAGE=runner:new-default\n')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'image-selection-changed'):
            self.select()

    def test_effective_pin_also_requires_verified_digest_and_actual_old_manager_images(self):
        pin = 'gitlab/gitlab-ce:old@sha256:' + '5' * 64
        self.images[pin] = {'Id': self.old_gitlab, 'RepoDigests': []}
        self.write('export GITLAB_IMAGE=' + pin + '\nexport GITLAB_RUNNER_IMAGE=runner:retained\n')
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'image-digest-unverified'):
            self.select()
        self.images[pin]['RepoDigests'] = [successor.recovery.canonical_digest(pin)]
        self.select()
        self.services['runner_docker_1']['Image'] = 'sha256:' + '6' * 64
        with self.assertRaisesRegex(successor.recovery.RecoveryError, 'running-image-mismatch'):
            self.select()


class ControllerCheckpointBounds(unittest.TestCase):
    def test_native_ancestry_checks_real_commits_and_refuses_an_unrelated_orphan(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            git('commit', '--allow-empty', '-qm', 'Original')
            original = git('rev-parse', 'HEAD')
            git('commit', '--allow-empty', '-qm', 'Accepted controller')
            staged = git('rev-parse', 'HEAD')
            git('commit', '--allow-empty', '-qm', 'Next candidate')
            target = git('rev-parse', 'HEAD')
            successor.verify_ancestry(original, staged, directory)
            successor.verify_ancestry(staged, target, directory)
            git('checkout', '--orphan', 'unrelated')
            git('commit', '--allow-empty', '-qm', 'Rewritten history')
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'not-descendant'):
                successor.verify_ancestry(staged, git('rev-parse', 'HEAD'), directory)

    def test_large_inventory_roundtrips_but_remains_forbidden_as_an_operator_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cold-checkpoint.json'
            value = {'format': 'system-controller-cold-checkpoint-v1', 'entries': {'gitlab': [], 'configuration': []},
                     'inventoryFixture': 'x' * (8 * 1024 ** 2)}
            successor.atomic_controller_checkpoint(path, value)
            self.assertEqual(json.loads(successor.controller_checkpoint_input(path)), value)
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'input-is-too-large'):
                successor.private_input(path)

    def test_writer_refuses_unreadable_checkpoint_before_atomic_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cold-checkpoint.json'
            with patch.object(successor, 'CONTROLLER_CHECKPOINT_LIMIT', 1024):
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'checkpoint-is-too-large'):
                    successor.atomic_controller_checkpoint(path, {'entries': 'x' * 1024})
                self.assertFalse(path.exists())
                successor.atomic_bytes(path, b'x' * 1025)
                with self.assertRaisesRegex(successor.recovery.RecoveryError, 'input-is-too-large'):
                    successor.controller_checkpoint_input(path)


class ColdMaintenanceContracts(unittest.TestCase):
    def setUp(self):
        self.commands = []
        sleeper = patch.object(promoter.time, 'sleep')
        sleeper.start()
        self.addCleanup(sleeper.stop)
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
        if 'status' in words: return b'down: native-service: 0s\n'
        return b''
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

    def test_abort_shared_cold_paths_resume_without_database_rewind_and_retain_uncertain_lease(self):
        from unittest.mock import Mock
        for early, failure in ((True, None), (False, None), (False, 'compose'), (True, 'jobs')):
            with self.subTest(early=early, failure=failure), tempfile.TemporaryDirectory() as directory:
                self.setUp()
                if failure == 'jobs':
                    self.proof['runningJobs'] = 1
                root = Path(directory)
                raw = (ROOT / 'system/.docker.env.example').read_bytes()
                main = root / 'main.env'
                main.write_bytes(raw)
                main.chmod(0o600)
                successor.atomic_bytes(root / 'main-before.env', raw)
                record = {'format': 'system-controller-promotion-v1', 'phase': 'cold-maintenance-started',
                          'coldPhase': 'old-controller-freeze-started' if early else 'GitLab-services-stop-started',
                          'leaseOperation': 'fixture', 'release': fixture()[0],
                          'configurationBeforeSha256': hashlib.sha256(raw).hexdigest(),
                          'configurationAfterSha256': 'f' * 64, 'oldGitLab': {'imageId': 'old-image'},
                          'previousController': {'imageId': 'old-image', 'restartPolicy': {'Name': 'always'}}}
                successor.atomic_json(root / 'operation.json', record)
                config = {'_main': main, '_persistence_env': root / 'settings.env'}
                self.rows.update(system_bootstrapper_1=self.controller, system_gitlab_1=self.gitlab, system_web_1=self.web)
                lease = Mock()
                def command(args, **kwargs):
                    if args[2] == 'compose':
                        self.commands.append(['compose'])
                        if failure == 'compose':
                            raise successor.recovery.RecoveryError('native-compose-uncertain')
                        self.controller['State'].update(Running=True, Paused=False)
                        self.gitlab['State'].update(Running=True)
                        return b''
                    return self.run_command(args, **kwargs)
                with patch.object(successor, 'verify_checkout'), \
                     patch.object(promoter, 'inspect', side_effect=lambda name: self.rows[name]), \
                     patch.object(successor.recovery, 'inspect_image', return_value={'Id': 'old-image'}), \
                     patch.object(successor.Lease, 'adopt', return_value=lease), \
                     patch.object(promoter, 'run', side_effect=command), \
                     patch.object(promoter, 'main_runner_rows', return_value=[self.runner]), \
                     patch.object(successor, 'environment', return_value={}), \
                     patch.object(promoter.runtime, 'settings', return_value=config), \
                     patch.object(promoter.runtime, 'inspect_services', return_value=self.rows), \
                     patch.object(promoter.runtime, 'verify_mounts'), \
                     patch.object(promoter.runtime, 'verify_routes'), \
                     patch.object(promoter.runtime, 'verify_sync'):
                    if failure:
                        message = 'native-compose-uncertain' if failure == 'compose' else 'new-running-jobs-refused'
                        with self.assertRaisesRegex(successor.recovery.RecoveryError, message):
                            promoter.abort_promotion(config, root)
                        lease.release.assert_not_called()
                        self.assertEqual(json.loads((root / 'operation.json').read_bytes()), record)
                    else:
                        promoter.abort_promotion(config, root)
                        lease.release.assert_called_once()
                        saved = json.loads((root / 'operation.json').read_bytes())
                        self.assertEqual(saved['phase'], 'aborted')
                        self.assertFalse(saved['databaseRewound'])
                        self.assertEqual(main.read_bytes(), raw)
                        self.assertEqual(self.controller['HostConfig']['RestartPolicy']['Name'], 'always')
                        self.assertEqual(any(row[0] == 'compose' for row in self.commands), not early)
                        if early:
                            self.assertFalse(any(row[0] == 'kill' for row in self.commands))

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
    def test_legacy_controller_seed_lease_is_owned_and_remembered_after_replacement(self):
        with tempfile.TemporaryDirectory(prefix='system-legacy-seed-lease-') as directory:
            root = Path(directory)
            for item in ('platform/configuration/.projects.env', 'platform/host/letsencrypt', 'seed'):
                (root / item).mkdir(parents=True)
            config = {'_root': root / 'platform', 'SEED_DIR': str(root / 'seed')}
            controller = {'Mounts': [{'Type': 'bind', 'Destination': '/seed', 'Source': str(root / 'seed')}]}
            lease = successor.Lease(config, legacy_controller=controller)
            lease.__enter__()
            self.assertTrue((root / 'seed/.operation-lock/controller-owner.json').is_file())
            lease.critical = True
            lease.__exit__(RuntimeError, RuntimeError('fixture interruption'), None)
            # The replacement controller no longer has /seed. Recovery uses the
            # private owned receipt rather than rediscovering only current mounts.
            adopted = successor.Lease.adopt(config, lease.operation)
            self.assertIn(root / 'seed/.operation-lock', adopted.held)
            adopted.release()
            self.assertFalse((root / 'seed/.operation-lock').exists())
            self.assertFalse((root / 'platform/configuration/.storage-operation-lock').exists())

    def test_running_legacy_harvest_is_never_bypassed_by_the_new_live_lease(self):
        with tempfile.TemporaryDirectory(prefix='system-legacy-seed-busy-') as directory:
            root = Path(directory)
            for item in ('platform/configuration/.projects.env', 'platform/host/letsencrypt', 'seed/.operation-lock'):
                (root / item).mkdir(parents=True)
            config = {'_root': root / 'platform', 'SEED_DIR': str(root / 'seed')}
            controller = {'Mounts': [{'Type': 'bind', 'Destination': '/seed', 'Source': str(root / 'seed')}]}
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'lease-unavailable'):
                with successor.Lease(config, legacy_controller=controller):
                    self.fail('An old Harvest still owns the Seed lease.')
            self.assertTrue((root / 'seed/.operation-lock').is_dir())
            self.assertFalse((root / 'platform/configuration/.storage-operation-lock').exists())

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
                self.assertIsNone(process_start(pid))
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
            self.assertEqual(process_start(child['childPid']), child['childStart'])
            with self.assertRaisesRegex(successor.recovery.RecoveryError, 'still-running'):
                successor.Lease.adopt(config, child['operation'])
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                final = json.loads(journal.read_bytes())
                if final.get('phase') == 'completed' and process_start(child['guardianPid']) != child['guardianStart']:
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
        return successor.recovery.host_operation('refreshRecoveryManifest', self.old, archive, source, self.alias, self.release['imageId'],
                                            self.evidence['evidence']['gitlabUpgrade']['toImage'],
                                            self.evidence['images']['gitlab'], self.wizard_ref, None, None)
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


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--watchdog-parent':
        root = Path(sys.argv[2])
        config = {'_root': root / 'platform', 'SEED_DIR': str(root / 'seed')}
        with successor.Lease(config) as lease:
            lease.critical = True
            successor.run([sys.executable, '-c', 'import time;time.sleep(1.5)'])
    else:
        unittest.main()
