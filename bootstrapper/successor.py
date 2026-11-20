#!/usr/bin/env python3
"""Shared, repository-owned successor release and operation boundaries."""
import datetime
import base64
import host_service
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
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
          'gitlab-upgrade-restored-checkpoint', 'storage-global-live-lease',
          'storage-refuse-nonempty-and-corrupt-restore',
          'storage-detached-backup-normal-operation', 'cleanup'}
STORAGE_PROOFS = {'localLiveVerified', 'externalSeedRestored', 'backupDetached',
                  'missingBackupGuardVerified', 'globalLeaseVerified', 'invalidRestoreGuardVerified'}
CONTROLLER_CHECKPOINT_LIMIT = 128 * 1024 ** 2


def run(arguments, **kwargs):
    if ACTIVE_LEASE is None:
        return recovery.run(arguments, **kwargs)
    timeout = recovery.budget(kwargs.pop('timeout', 300))
    return base64.b64decode(ACTIVE_LEASE.call('command', list(arguments), timeout,
        base64.b64encode(kwargs.get('input') or b'').decode(), kwargs.get('env')))


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


def atomic_bytes(path, value, mode=0o600, owner=None):
    path = Path(path)
    require(not path.is_symlink(), 'atomic-output-must-not-be-symlink')
    temporary = path.with_name('.' + path.name + '.tmp-' + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            if owner is not None:
                os.fchown(stream.fileno(), *owner)
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
    import base64
    value = recovery.host_operation('releaseInputs', base64.b64encode(release_bytes).decode(),
                                    base64.b64encode(evidence_bytes).decode(), security_release)
    return value['release'], value['evidence']


def verify_source_objects(release, checkout):
    return recovery.host_operation('verifySourceObjects', release, checkout)


def verify_checkout(release, checkout):
    return recovery.host_operation('verifyCheckout', release, checkout)


def verify_ancestry(earlier, later, checkout):
    return recovery.host_operation('verifyAncestry', earlier, later, checkout)


def _candidate_operation(api, operation, *arguments):
    def dispatch(method, args):
        if method == 'raw': return base64.b64encode(api.raw(args[0])[0]).decode()
        if method in ('get', 'pages'): return getattr(api, method)(args[0])
        raise recovery.RecoveryError('candidate-authority-port-invalid')
    outcome = host_service.invoke('candidate-authority-entry.js', {'operation': operation, 'arguments': arguments},
                               dispatch, recovery.RecoveryError)
    if 'rejected' in outcome: raise recovery.RecoveryError(outcome['rejected'])
    return outcome['result']


def verify_pipeline(api, release, release_bytes, evidence_bytes):
    from public_release import PublicReleaseAuthority
    if isinstance(api, PublicReleaseAuthority):
        return api.verify_pipeline(release, release_bytes, evidence_bytes)
    return _verify_pipeline(api, release, release_bytes, evidence_bytes, current=True)


def wizard_release(release, evidence):
    return _candidate_operation(None, 'wizard', release, evidence)


def verify_public_pair(api, release, evidence, controller, wizard):
    from public_release import PublicReleaseAuthority
    if isinstance(api, PublicReleaseAuthority):
        return api.verify_pair(release, evidence, controller, wizard)
    return _candidate_operation(api, 'pair', release, evidence, controller, wizard)


def verify_completed_promotion(api, record, security):
    value = _candidate_operation(api, 'completed', record, security)
    return value['release'], value['evidence']


def _verify_pipeline(api, release, release_bytes, evidence_bytes, current):
    return _candidate_operation(api, 'pipeline', release, base64.b64encode(release_bytes).decode(),
                                base64.b64encode(evidence_bytes).decode(), current)


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
                  PERSISTENCE_MODE=config.get('PERSISTENCE_MODE', 'volume'),
                  PERSISTENT_MOUNT=config['PERSISTENT_MOUNT'], PERSISTENT_DIR=str(root),
                  PERSISTENT_UUID=config['PERSISTENT_UUID'], SEED_DIR=config.get('SEED_DIR', ''),
                  SEED_MOUNT=config.get('SEED_MOUNT', ''), SEED_UUID=config.get('SEED_UUID', ''))
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
    """Transitional argument adapter to the shared native durable lease provider."""
    def __init__(self, config, legacy_controller=None):
        self.input = {'root': str(config['_root']), 'seedDirectory': config.get('SEED_DIR'),
                      'legacyController': legacy_controller}
        self.held = []
        self._critical = False

    def remember(self, value):
        self.operation = value['operation']
        self.paths = [Path(value) for value in value['paths']]
        self.held = [Path(value) for value in value['held']]
        self.legacy_seed = value['legacySeed']
        self._critical = value['critical']
        return self

    def call(self, method, *arguments):
        return recovery.host_operation('controllerLease', method, self.operation, *arguments)

    @property
    def critical(self):
        return self._critical

    @critical.setter
    def critical(self, value):
        self.call('critical', bool(value))
        self._critical = bool(value)

    def __enter__(self):
        global ACTIVE_LEASE
        self.remember(recovery.host_operation('controllerLease', 'acquire', self.input))
        ACTIVE_LEASE = self
        return self

    @classmethod
    def adopt(cls, config, operation):
        global ACTIVE_LEASE
        value = cls(config)
        value.remember(recovery.host_operation('controllerLease', 'adopt', value.input, operation))
        ACTIVE_LEASE = value
        return value

    def assert_idle(self, directory):
        self.call('idle', str(directory))

    def release(self):
        global ACTIVE_LEASE
        self.call('release')
        self.held = []
        if ACTIVE_LEASE is self:
            ACTIVE_LEASE = None

    def __exit__(self, kind, value, traceback):
        global ACTIVE_LEASE
        try:
            self.call('finish', kind is not None)
        finally:
            if kind is not None and self.critical:
                # Receipt identity belongs to the native coordinator. Closing it
                # makes adoption possible while a detached guardian retains flock.
                sys.modules['_system_host_rpc'].close('controller-lease-entry.js')
            if ACTIVE_LEASE is self:
                ACTIVE_LEASE = None
