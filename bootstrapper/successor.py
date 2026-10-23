#!/usr/bin/env python3
"""Shared, repository-owned successor release and operation boundaries."""
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('system_runtime', HERE / 'verify-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
recovery = runtime.recovery
require = recovery.require
ACTIVE_LEASE = None
DOCKER = runtime.DOCKER
EVIDENCE_PATH = 'test-results/successor/candidate-results.json'
RELEASE_PATH = 'test-results/successor/release.json'
REQUIRED_JOBS = {'check:documentation', 'prepare:wizard-source', 'test:candidate-image',
                 'test:platform-candidate', 'build'}
COMPONENTS = {'gitlab', 'sync', 'gitlab-runner', 'bootstrapper', 'nginx', 'wizard', 'shared', 'performance'}
STAGES = {'gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci',
          'gitlab-upgrade-restored-checkpoint', 'cleanup'}
CONTROLLER_CHECKPOINT_LIMIT = 128 * 1024 ** 2


def run(arguments, **kwargs):
    if ACTIVE_LEASE is None:
        return recovery.run(arguments, **kwargs)
    timeout = recovery.budget(kwargs.pop('timeout', 300))
    # The guardian survives this coordinator's session/process death and keeps
    # its inherited flock until the specific command group has been reaped.
    helper = subprocess.Popen([sys.executable, str(HERE / 'host-child.py'),
        '--guard-fd', str(ACTIVE_LEASE.guard), '--journal', str(ACTIVE_LEASE.paths[0] / 'host-child.json'),
        '--operation', ACTIVE_LEASE.operation, '--timeout', str(timeout), '--', *arguments],
        pass_fds=(ACTIVE_LEASE.guard,), start_new_session=True,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=kwargs.get('env'))
    try:
        output, error = helper.communicate(input=kwargs.get('input') or b'', timeout=timeout + 30)
    except subprocess.TimeoutExpired:
        # Do not terminate an uncertain guardian and release its inherited lock.
        # It has its own finite child deadline; adoption remains blocked meanwhile.
        raise recovery.RecoveryError('owned-host-command-is-still-draining') from None
    require(helper.returncode == 0, 'command-failed:' + arguments[0])
    return output


def group_live(pgid):
    if not isinstance(pgid, int) or pgid <= 0:
        return False
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rpartition(')')[2].split()
            if int(fields[2]) == pgid and fields[0] != 'Z':
                return True
        except (FileNotFoundError, PermissionError, ValueError, IndexError):
            continue
    return False


def _private_bytes(path, maximum):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and not path.stat().st_mode & 0o077,
            'private-regular-input-required')
    require(path.stat().st_size <= maximum, 'input-is-too-large')
    with path.open('rb') as stream:
        value = stream.read(maximum + 1)
    require(len(value) <= maximum, 'input-is-too-large')
    return value


def private_input(path):
    return _private_bytes(path, 8 * 1024 ** 2)


def controller_checkpoint_input(path):
    return _private_bytes(path, CONTROLLER_CHECKPOINT_LIMIT)


def atomic_controller_checkpoint(path, value):
    raw = (json.dumps(value, indent=2) + '\n').encode()
    require(len(raw) <= CONTROLLER_CHECKPOINT_LIMIT, 'controller-checkpoint-is-too-large')
    atomic_bytes(path, raw)


def atomic_bytes(path, value, mode=0o600):
    path = Path(path)
    require(not path.is_symlink(), 'atomic-output-must-not-be-symlink')
    temporary = path.with_name('.' + path.name + '.tmp-' + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def directory_barrier(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def process_start(pid):
    try:
        fields = Path('/proc/' + str(pid) + '/stat').read_text().rpartition(')')[2].split()
        return None if fields[0] == 'Z' else fields[19]
    except (FileNotFoundError, IndexError):
        return None


def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2) + '\n').encode())


class GitLab:
    def __init__(self, base, token_file):
        parsed = urllib.parse.urlsplit(base)
        require(parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and
                parsed.path in ('', '/') and not parsed.query and not parsed.fragment,
                'GitLab-HTTPS-origin-required')
        self.base = base.rstrip('/')
        self.token = private_input(token_file).decode().strip()
        require(bool(self.token) and '\n' not in self.token and '\r' not in self.token,
                'invalid-GitLab-token-file')
        self.opener = urllib.request.build_opener(runtime.NoRedirect())

    def raw(self, endpoint):
        require(endpoint.startswith('/') and not endpoint.startswith('//'), 'invalid-GitLab-endpoint')
        request = urllib.request.Request(self.base + '/api/v4' + endpoint,
                                         headers={'PRIVATE-TOKEN': self.token})
        try:
            with self.opener.open(request, timeout=30) as response:
                require(response.status == 200, 'GitLab-API-request-failed')
                value = response.read(8 * 1024 ** 2 + 1)
                require(len(value) <= 8 * 1024 ** 2, 'GitLab-API-response-too-large')
                return value, dict(response.headers)
        except (urllib.error.URLError, OSError):
            raise recovery.RecoveryError('GitLab-API-request-failed') from None

    def get(self, endpoint):
        return json.loads(self.raw(endpoint)[0])

    def pages(self, endpoint):
        result = []
        for page in range(1, 101):
            value, headers = self.raw(endpoint + ('&' if '?' in endpoint else '?') + f'per_page=100&page={page}')
            rows = json.loads(value)
            require(isinstance(rows, list), 'GitLab-API-array-required')
            result.extend(rows)
            if not headers.get('X-Next-Page'):
                return result
        raise recovery.RecoveryError('GitLab-API-pagination-limit')


def release_inputs(release_bytes, evidence_bytes, security_release):
    release, evidence = json.loads(release_bytes), json.loads(evidence_bytes)
    require(isinstance(release, dict) and release.get('format') == 'system-successor-release-v1',
            'invalid-successor-release-format')
    for key in ('sourceRevision', 'sourceTree', 'wizardRevision'):
        require(recovery.git_id(release.get(key)), 'invalid-successor-source-identity')
    for key in ('projectId', 'pipelineId', 'candidateJobId'):
        require(type(release.get(key)) is int and release[key] > 0, 'invalid-successor-CI-identity')
    require(recovery.image_id(release.get('imageId')) and
            recovery.reference(release.get('registryReference')) and
            recovery.canonical_digest(release['registryReference']) == release['registryReference'] and
            release['registryReference'].split('@')[0] == release.get('registryRepository'),
            'invalid-immutable-successor-image')
    require(release.get('candidateEvidencePath') == EVIDENCE_PATH and
            release.get('candidateEvidenceSha256') == hashlib.sha256(evidence_bytes).hexdigest(),
            'successor-evidence-hash-or-path-mismatch')
    require(isinstance(evidence, dict) and evidence.get('sourceRevision') == release['sourceRevision'] and
            evidence.get('fullAcceptance') is True and
            re.fullmatch(r'[a-f0-9]{24}', evidence.get('runId', '')) is not None,
            'successor-full-acceptance-required')
    rows = evidence.get('results')
    require(isinstance(rows, list) and bool(rows) and all(row.get('status') == 'passed' for row in rows),
            'successor-stage-did-not-pass')
    require(STAGES <= {row.get('name') for row in rows}, 'successor-required-migration-stage-missing')
    images, upgrade = evidence.get('images', {}), evidence.get('evidence', {}).get('gitlabUpgrade', {})
    require(images.get('candidate') == release['imageId'] and
            upgrade.get('fromImage') == security_release.get('fromImage') and
            upgrade.get('toImage') == security_release.get('toImage') and
            all(upgrade.get(key) is True for key in ('migrationVerified', 'rollbackVerified',
                                                    'registryVerified', 'checkpointVerified')) and
            recovery.image_id(upgrade.get('fromImageId')) and recovery.image_id(upgrade.get('toImageId')) and
            images.get('gitlab') == upgrade['toImageId'], 'successor-migration-evidence-mismatch')
    return release, evidence


def verify_source_objects(release, checkout):
    checkout = str(checkout)
    require(run(['git', '-C', checkout, 'rev-parse', release['sourceRevision'] + '^{tree}']).decode().strip() == release['sourceTree'],
            'successor-checkout-tree-mismatch')
    require(run(['git', '-C', checkout, 'ls-tree', release['sourceRevision'], 'wizard']).decode().strip() ==
            '160000 commit ' + release['wizardRevision'] + '\twizard', 'successor-checkout-gitlink-mismatch')


def verify_checkout(release, checkout):
    checkout = str(checkout)
    require(not run(['git', '-C', checkout, 'status', '--porcelain']).strip(), 'successor-checkout-is-modified')
    require(run(['git', '-C', checkout, 'rev-parse', 'HEAD']).decode().strip() == release['sourceRevision'],
            'successor-checkout-revision-mismatch')
    verify_source_objects(release, checkout)


def verify_ancestry(earlier, later, checkout):
    require(recovery.git_id(earlier) and recovery.git_id(later), 'staged-controller-source-identity-invalid')
    try:
        run(['git', '--no-replace-objects', '-C', str(checkout), 'merge-base', '--is-ancestor', earlier, later])
    except recovery.RecoveryError:
        raise recovery.RecoveryError('staged-controller-source-is-not-descendant') from None


def normalized_job(name):
    match = re.fullmatch(r'test:isolated:\s*\[([a-z-]+)\]', name)
    return ('component', match[1]) if match else ('job', name)


def verify_pipeline(api, release, release_bytes, evidence_bytes):
    return _verify_pipeline(api, release, release_bytes, evidence_bytes, current=True)


def verify_completed_promotion(api, record, security):
    require(record.get('format') == 'system-controller-promotion-v1' and
            record.get('phase') == 'controller-promoted-old-GitLab-preserved' and
            record.get('GitLabMigrationStarted') is False and
            type(record.get('coldMaintenance')) is bool and
            all(record.get(key) is True for key in ('oldGitLabImagePreserved',
                'configurationChangedOnlyControllerImage', 'managerIdentitiesPreserved')),
            'completed-staged-controller-promotion-required')
    retained = record.get('release', {})
    require(isinstance(retained, dict) and
            all(type(retained.get(key)) is int and retained[key] > 0 for key in ('projectId', 'candidateJobId')),
            'invalid-staged-controller-release')
    artifact = '/projects/' + str(retained['projectId']) + '/jobs/' + str(retained['candidateJobId']) + '/artifacts/'
    release_bytes = api.raw(artifact + RELEASE_PATH)[0]
    evidence_bytes = api.raw(artifact + EVIDENCE_PATH)[0]
    release, evidence = release_inputs(release_bytes, evidence_bytes, security)
    require(release == retained, 'staged-controller-release-does-not-match-CI')
    pipeline = _verify_pipeline(api, release, release_bytes, evidence_bytes, current=False)
    require(pipeline == record.get('pipeline'), 'staged-controller-pipeline-receipt-mismatch')
    return release, evidence


def _verify_pipeline(api, release, release_bytes, evidence_bytes, current):
    project = api.get('/projects/' + str(release['projectId']))
    branch = project.get('default_branch')
    require(isinstance(branch, str) and bool(branch), 'GitLab-default-branch-required')
    require(project.get('only_allow_merge_if_pipeline_succeeds') is True, 'GitLab-required-merge-gate-disabled')
    require(release['registryRepository'] == project.get('container_registry_image_prefix', '') + '/successor',
            'successor-registry-project-mismatch')
    prefix = '/projects/' + str(release['projectId'])
    pipeline = api.get(prefix + '/pipelines/' + str(release['pipelineId']))
    require(pipeline.get('sha') == release['sourceRevision'] and pipeline.get('ref') == branch and
            pipeline.get('source') in ('push', 'web', 'schedule'),
            'successor-default-branch-pipeline-required')
    branch_state = api.get(prefix + '/repository/branches/' + urllib.parse.quote(branch, safe=''))
    require(branch_state.get('protected') is True, 'GitLab-default-branch-is-not-protected')
    if current:
        require(branch_state.get('commit', {}).get('id') == release['sourceRevision'], 'successor-default-branch-advanced')
    jobs = api.pages(prefix + '/pipelines/' + str(release['pipelineId']) + '/jobs?include_retried=false')
    selected = {}
    for row in jobs:
        key = normalized_job(row.get('name', ''))
        require(key not in selected, 'successor-duplicate-job-identity')
        selected[key] = row
    required = [('job', name) for name in REQUIRED_JOBS] + [('component', name) for name in COMPONENTS]
    for key in required:
        row = selected.get(key, {})
        require(row.get('status') == 'success' and row.get('allow_failure') is False,
                'successor-required-job-not-successful')
        require(row.get('pipeline', {}).get('id', release['pipelineId']) == release['pipelineId'],
                'successor-job-pipeline-mismatch')
    require(selected[('job', 'test:platform-candidate')].get('id') == release['candidateJobId'],
            'successor-candidate-job-mismatch')
    failed = [row for row in jobs if row.get('status') in ('failed', 'canceled')]
    require(all(row.get('name') == 'deploy:github' and row.get('status') == 'failed' for row in failed),
            'successor-internal-pipeline-failed')
    require(pipeline.get('status') == 'success' or
            (pipeline.get('status') == 'failed' and len(failed) == 1 and failed[0].get('name') == 'deploy:github'),
            'successor-pipeline-not-complete')
    artifact = prefix + '/jobs/' + str(release['candidateJobId']) + '/artifacts/'
    remote_release = api.raw(artifact + RELEASE_PATH)[0]
    remote_evidence = api.raw(artifact + EVIDENCE_PATH)[0]
    require(hashlib.sha256(remote_release).digest() == hashlib.sha256(release_bytes).digest() and
            hashlib.sha256(remote_evidence).digest() == hashlib.sha256(evidence_bytes).digest(),
            'successor-inputs-do-not-match-CI-artifacts')
    return {'projectId': release['projectId'], 'pipelineId': release['pipelineId'],
            'candidateJobId': release['candidateJobId'], 'sourceRevision': release['sourceRevision'],
            'requiredJobsPassed': len(required), 'GitHubMirrorFailed': bool(failed)}


def controller_alias(release):
    return 'system-successor:' + release['sourceRevision'] + '-job' + str(release['candidateJobId'])


def assignment(raw, key, value):
    runtime.cube(raw)
    require(key == 'BOOTSTRAPPER_IMAGE' and
            re.fullmatch(r'system-successor:[a-f0-9]{40}-job[1-9][0-9]*', value) is not None,
            'invalid-controller-image-assignment')
    pattern = re.compile(rb'(?m)^(?:export )?' + key.encode() + rb'=.*$')
    matches = list(pattern.finditer(raw))
    require(len(matches) <= 1 and all(match.start() >= 1184 for match in matches),
            'duplicate-or-header-controller-assignment')
    line = b"export " + key.encode() + b"='" + value.encode() + b"'"
    updated = pattern.sub(lambda _: line, raw) if matches else raw + (b'' if raw.endswith(b'\n') else b'\n') + line + b'\n'
    runtime.cube(updated)
    return updated


def environment(config, reference, staged=False):
    root = config['_root']
    files = [root / 'configuration/sync-auth.env', config['_main']]
    raw = run(['bash', '-c', 'set -e; set -a; source "$1"; source "$2"; env -0',
               'controller-environment', *map(str, files)])
    result = dict(os.environ)
    for pair in raw.split(b'\0'):
        if pair:
            key, value = pair.split(b'=', 1)
            result[key.decode()] = value.decode()
    for key in ('DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
        result.pop(key, None)
    result.update(DOCKER_HOST='unix:///var/run/docker.sock', BOOTSTRAPPER_IMAGE=reference,
                  PERSISTENT_MOUNT=config['PERSISTENT_MOUNT'], PERSISTENT_DIR=str(root),
                  PERSISTENT_UUID=config['PERSISTENT_UUID'], SEED_DIR=config['SEED_DIR'])
    if staged:
        result['SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER'] = '1'
    else:
        result.pop('SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER', None)
    return result


def sync_idle(config):
    base = runtime.origin(config, 'SYNC')
    status, body, _ = runtime.http(base + '/login', {'username': config['SYNC_USER'], 'password': config['SYNC_PASS']})
    require(status == 200, 'controller-promotion-sync-authentication-failed')
    token = json.loads(body).get('accessToken')
    require(isinstance(token, str), 'controller-promotion-sync-token-missing')
    status, body, _ = runtime.http(base + '/status', headers={'Authorization': 'Bearer ' + token})
    require(status == 200, 'controller-promotion-sync-status-unavailable')
    value = json.loads(body)
    # Absence is not false: an older API cannot prove the project queue is idle.
    require('projectOperationInProgress' in value, 'controller-promotion-versioned-quiescence-bridge-required')
    require(all(value.get(key) is False for key in ('projectOperationInProgress', 'runnerSetupInProgress',
                                                   'harvestInProgress', 'defaultWizardSetupInProgress', 'needRestart')),
            'controller-promotion-operation-is-busy')


class Lease:
    def __init__(self, config):
        root = config['_root']
        require(not (root / 'configuration/.gitlab-upgrade-lock').exists() and
                not (root / 'gitlab/data/.system-bootstrapper-restore-incomplete').exists(),
                'unfinished-GitLab-operation-blocks-controller-promotion')
        self.paths = [root / 'configuration/.gitlab-upgrade-lock',
                      Path(config['SEED_DIR']) / '.operation-lock',
                      root / 'host/letsencrypt/.system-bootstrapper-certificate-lock',
                      root / 'configuration/.projects.env/.wizard.env.environments.lock']
        self.operation = uuid.uuid4().hex
        self.held = []
        self.critical = False

    def acquire_guard(self, root):
        self.guard = os.open(root / 'configuration/.controller-host-guard.lock',
                             os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        require(os.fstat(self.guard).st_uid == os.geteuid() and not os.fstat(self.guard).st_mode & 0o077,
                'private-controller-host-guard-required')
        try:
            fcntl.flock(self.guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self.guard)
            self.guard = None
            raise recovery.RecoveryError('controller-host-command-or-coordinator-still-running') from None

    def __enter__(self):
        global ACTIVE_LEASE
        self.acquire_guard(self.paths[0].parent.parent)
        try:
            for path in self.paths:
                path.mkdir(mode=0o700)
                self.held.append(path)
                atomic_json(path / 'controller-owner.json', {'format': 'system-controller-operation-v1',
                                                            'operation': self.operation, 'pid': os.getpid(),
                                                            'processStart': process_start(os.getpid()),
                                                            'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
        except Exception:
            self.release()
            raise recovery.RecoveryError('controller-operation-lease-unavailable') from None
        ACTIVE_LEASE = self
        return self

    @classmethod
    def adopt(cls, config, operation):
        value = object.__new__(cls)
        root = config['_root']
        value.paths = [root / 'configuration/.gitlab-upgrade-lock', Path(config['SEED_DIR']) / '.operation-lock',
                       root / 'host/letsencrypt/.system-bootstrapper-certificate-lock',
                       root / 'configuration/.projects.env/.wizard.env.environments.lock']
        value.operation, value.held, value.critical = operation, [], True
        value.acquire_guard(root)
        try:
            journal = value.paths[0] / 'host-child.json'
            if journal.exists():
                child = json.loads(private_input(journal))
                require(child.get('operation') == operation, 'controller-host-child-owner-mismatch')
                same_boot = child.get('bootId') == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                guardian_ended = process_start(child.get('guardianPid')) != child.get('guardianStart')
                worker_ended = ('childPid' not in child or
                                process_start(child['childPid']) != child.get('childStart'))
                require(not same_boot or (guardian_ended and worker_ended and not group_live(child.get('childPgid'))),
                        'controller-host-child-is-still-running')
                if child.get('phase') != 'completed':
                    child.update(phase='completed', interrupted=True, exitCode=None)
                    atomic_json(journal, child)
            for path in value.paths:
                owner = json.loads(private_input(path / 'controller-owner.json'))
                require(owner.get('format') == 'system-controller-operation-v1' and
                        owner.get('operation') == operation, 'controller-recovery-lease-ownership-mismatch')
                require(type(owner.get('pid')) is int and owner['pid'] > 0 and
                        isinstance(owner.get('processStart'), str) and owner['processStart'].isdigit(),
                        'invalid-controller-lease-process-identity')
                same_boot = owner.get('bootId') == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                require(not same_boot or process_start(owner['pid']) != owner['processStart'], 'controller-operation-is-still-running')
                value.held.append(path)
            for path in value.held:
                atomic_json(path / 'controller-owner.json', {'format': 'system-controller-operation-v1',
                             'operation': operation, 'pid': os.getpid(), 'processStart': process_start(os.getpid()),
                                                                'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
        except BaseException:
            os.close(value.guard)
            value.guard = None
            raise
        global ACTIVE_LEASE
        ACTIVE_LEASE = value
        return value

    def release(self):
        global ACTIVE_LEASE
        journal = self.paths[0] / 'host-child.json'
        if journal.exists():
            child = json.loads(private_input(journal))
            require(child.get('operation') == self.operation and child.get('phase') == 'completed',
                    'controller-host-child-has-not-finished')
            journal.unlink()
        for path in reversed(self.held):
            owner = path / 'controller-owner.json'
            require(json.loads(private_input(owner)).get('operation') == self.operation,
                    'controller-operation-lease-ownership-changed')
            owner.unlink()
            path.rmdir()
        self.held = []
        if getattr(self, 'guard', None) is not None:
            os.close(self.guard)
            self.guard = None
        if ACTIVE_LEASE is self:
            ACTIVE_LEASE = None

    def __exit__(self, kind, value, traceback):
        if kind is None or not self.critical:
            self.release()
        else:
            global ACTIVE_LEASE
            if self.guard is not None:
                os.close(self.guard)
                self.guard = None
            if ACTIVE_LEASE is self:
                ACTIVE_LEASE = None
        # A failed deployment retains the exact owned lease for investigation.
