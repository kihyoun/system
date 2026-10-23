#!/usr/bin/env python3
"""Capture a private pre-start baseline or verify a retained-volume platform.

Only fixed diagnostic labels are printed; credentials and raw Docker/HTTP output
remain in memory. Baselines and result files contain no configuration contents.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('system_recovery', HERE / 'recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
require, run = recovery.require, recovery.run
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
KEYS = ['PERSISTENT_MOUNT', 'PERSISTENT_DIR', 'PERSISTENT_UUID', 'SEED_DIR', 'BOOTSTRAPPER_IMAGE',
        'WIZARD_IMAGE', 'NGINX_IMAGE', 'GITLAB_IMAGE', 'GITLAB_RUNNER_IMAGE', 'GITLAB_RUNNER_SCALE',
        'WIZARD_ENABLE', 'SYNC_ENABLE', 'WIZARD_HOST', 'SYNC_HOST', 'GITLAB_HOST', 'GITLAB_REGISTRY_HOST',
        'WIZARD_DOMAIN_MODE', 'SYNC_DOMAIN_MODE', 'GITLAB_DOMAIN_MODE', 'GITLAB_REGISTRY_DOMAIN_MODE',
        'SYNC_USER', 'SYNC_PASS', 'GITLAB_EXTERNAL_URL', 'GITLAB_REGISTRY_URL']


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_private(path, data):
    path = Path(path)
    require(not path.is_symlink(), 'receipt-must-not-be-symlink')
    payload = (json.dumps(data, indent=2) + '\n').encode()
    # O_EXCL avoids following an existing link while publishing a new receipt.
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_values(files, keys=KEYS):
    # These are trusted operator-owned shell assignments, as used by start.sh.
    # Fixed names are emitted as NUL-separated values, never all of the environment.
    script = 'set -e; set -a; for config in "$@"; do source "$config"; done; '
    script += ''.join('printf "%s\\0" "${' + key + '-}"; ' for key in keys)
    raw = run(['bash', '-c', script, 'read-config', *map(str, files)])
    values = raw.split(b'\0')
    require(len(values) == len(keys) + 1 and values[-1] == b'', 'configuration-value-format')
    return dict(zip(keys, (value.decode() for value in values[:-1])))


def settings(persistence):
    storage = read_values([persistence], ['PERSISTENT_MOUNT', 'PERSISTENT_DIR', 'PERSISTENT_UUID', 'SEED_DIR'])
    environment = dict(os.environ, **storage)
    try:
        subprocess.run(['bash', str(HERE / 'persistence.sh')], env=environment,
                       check=True, capture_output=True, timeout=30)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise recovery.RecoveryError('persistent-storage-preflight-failed') from None
    root = Path(storage['PERSISTENT_DIR']).resolve(strict=True)
    main = root / 'configuration/.docker.env'
    require(main.is_file() and not main.is_symlink(), 'saved-configuration-required')
    auth = root / 'configuration/sync-auth.env'
    require(not auth.is_symlink(), 'sync-auth-must-not-be-symlink')
    result = read_values(([auth] if auth.is_file() else []) + [main])
    result.update(storage)  # Host-selected storage always wins over saved settings.
    result['_root'] = root
    result['_main'] = main
    return result


def runner_count(config):
    raw = config.get('GITLAB_RUNNER_SCALE', '')
    require(raw.isdigit() and 0 <= int(raw) <= 50, 'invalid-runner-count')
    return int(raw)


def cube(raw):
    require(raw[807:808] == b'$' and hashlib.md5(raw[:1184]).hexdigest() ==
            'bd4a8426355824593a5e21ad759830c1', 'cube-signature-mismatch')


def configuration_files(root):
    files = [root / 'configuration/.docker.env', root / 'configuration/sync-auth.env']
    files += sorted((root / 'configuration/.projects.env').glob('*.env'))
    return {str(path.relative_to(root)): recovery.sha(path) for path in files if path.is_file()}


def capture(config, checkout):
    root = config['_root']
    cube(config['_main'].read_bytes())
    require(not run(['git', '-C', str(checkout), 'status', '--porcelain']).strip(),
            'initialization-checkout-is-modified')
    manifest = recovery.load_manifest(root / 'recovery', checkout)
    recovery.validate_selected_images(manifest, config['_main'])
    identities = {}
    for index in range(1, runner_count(config) + 1):
        path = root / f'runners/runner/{index}/config/.runner_system_id'
        if path.is_file():
            identities[str(index)] = recovery.sha(path)
    return {'schemaVersion': 1, 'startedAt': now(), 'configurationFiles': configuration_files(root),
            'manifestSha256': recovery.sha(root / 'recovery/images.json'),
            'runnerManagerIdentitySha256': identities, 'expectedRunnerCount': runner_count(config),
            'sourceCommit': manifest['sourceCommit'], 'sourceTree': manifest['sourceTree'],
            'hostToolsRevision': run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).decode().strip()}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http(url, body=None, headers=None):
    selected = dict(headers or {})
    if body is not None:
        selected['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers=selected)
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    except (urllib.error.URLError, OSError):
        raise recovery.RecoveryError('application-endpoint-not-ready') from None
    with response:
        return response.code, response.read(4 * 1024 ** 2), response.headers


def origin(config, prefix):
    host = config[prefix + '_HOST']
    require(host and all(character not in host for character in '/@?#\r\n '), 'invalid-service-host')
    mode = config[prefix + '_DOMAIN_MODE']
    require(mode in ('0', '1', '2', '3'), 'invalid-domain-mode')
    return ('https://' if mode in ('2', '3') else 'http://') + host


def assert_baseline(config, baseline):
    root = config['_root']
    require(configuration_files(root) == baseline['configurationFiles'], 'saved-configuration-changed')
    require(recovery.sha(root / 'recovery/images.json') == baseline['manifestSha256'], 'recovery-manifest-changed')
    require(runner_count(config) == baseline['expectedRunnerCount'], 'runner-count-changed')
    for index, expected in baseline['runnerManagerIdentitySha256'].items():
        path = root / f'runners/runner/{index}/config/.runner_system_id'
        require(path.is_file() and recovery.sha(path) == expected, 'retained-runner-identity-changed')
    cube(config['_main'].read_bytes())


def inspect_services(config):
    names = ['system_bootstrapper_1', 'system_web_1', 'system_gitlab_1']
    if config['WIZARD_ENABLE'] == 'true':
        names.append('system_wizard_1')
    names += [f'runner_docker_{index}' for index in range(1, runner_count(config) + 1)]
    rows = json.loads(run([*DOCKER, 'inspect', *names]))
    require({row['Name'].lstrip('/') for row in rows} == set(names), 'expected-services-missing')
    for row in rows:
        require(row['State']['Running'] and not row['State'].get('OOMKilled'), 'service-not-running')
        if row['State'].get('Health'):
            require(row['State']['Health']['Status'] == 'healthy', 'service-not-healthy')
    return {row['Name'].lstrip('/'): row for row in rows}


def verify_images(config, manifest, services):
    expected = {'system_bootstrapper_1': manifest['currentController']['imageId']}
    selected = [('system_web_1', 'NGINX_IMAGE', 'nginx'), ('system_gitlab_1', 'GITLAB_IMAGE', '')]
    selected += [(f'runner_docker_{index}', 'GITLAB_RUNNER_IMAGE', '')
                 for index in range(1, runner_count(config) + 1)]
    if config['WIZARD_ENABLE'] == 'true':
        selected.append(('system_wizard_1', 'WIZARD_IMAGE', ''))
    for name, key, default in selected:
        image = config[key] or default
        require(bool(image), 'saved-image-selection-required')
        inspected = recovery.inspect_image(image)
        expected[name] = inspected['Id']
        if '@sha256:' in image:
            require(recovery.canonical_digest(image) in inspected.get('RepoDigests', []), 'running-image-digest-not-verified')
    declared = {row['tag']: row for row in manifest['publicImages'] + manifest['localImages']}
    for key, fallback in [('BOOTSTRAPPER_IMAGE', 'system_bootstrapper'), ('NGINX_IMAGE', 'nginx'),
                          ('GITLAB_IMAGE', ''), ('GITLAB_RUNNER_IMAGE', '')]:
        reference = config[key] or fallback
        match = declared.get(reference)
        if match is None:
            match = next((row for row in manifest['publicImages'] if row['reference'] == reference), None)
        require(match is not None, 'saved-image-is-not-declared-in-manifest')
        inspected = recovery.inspect_image(reference)
        if match.get('imageId'):
            require(inspected['Id'] == match['imageId'], 'image-alias-retargeted')
    for name, image in expected.items():
        require(services[name]['Image'] == image, 'service-image-selection-mismatch')


def verify_mounts(config, services):
    root, mount = config['_root'], Path(config['PERSISTENT_MOUNT']).resolve(strict=True)
    seed = Path(config['SEED_DIR']).resolve(strict=True)
    require(mount in seed.parents and root not in seed.parents and seed not in root.parents and seed != root,
            'unsafe-seed-directory')
    device = run(['findmnt', '-rn', '-T', str(mount), '-o', 'MAJ:MIN']).strip()
    volumes, count = {}, 0
    for row in services.values():
        for entry in row['Mounts']:
            if entry['Type'] == 'tmpfs' or entry['Destination'] == '/var/run/docker.sock':
                continue
            source = entry['Source']
            if entry.get('Name'):
                name = entry['Name']
                if name not in volumes:
                    volumes[name] = json.loads(run([*DOCKER, 'volume', 'inspect', name]))[0]
                options = volumes[name].get('Options') or {}
                require(options.get('type') == 'none' and options.get('o') == 'bind', 'persistent-volume-not-bind')
                source = options.get('device', '')
            path = Path(source).resolve(strict=True)
            require(path == root or root in path.parents or (path == seed and entry['Destination'] == '/seed'),
                    'persistent-mount-escapes-selected-data')
            require(run(['findmnt', '-rn', '-T', str(path), '-o', 'MAJ:MIN']).strip() == device,
                    'persistent-mount-is-on-another-filesystem')
            count += 1
    require(count > 0, 'persistent-mounts-missing')
    return count


def verify_sync(config):
    require(config['SYNC_ENABLE'] == 'true', 'authenticated-fetch-requires-enabled-sync')
    base = origin(config, 'SYNC')
    status, payload, _ = http(base + '/login', {'username': config['SYNC_USER'], 'password': config['SYNC_PASS']})
    require(status == 200, 'sync-login-failed')
    login = json.loads(payload)
    status, payload, _ = http(base + '/token', {'token': login['refreshToken']})
    require(status == 200, 'sync-token-failed')
    access = json.loads(payload)['accessToken']
    status, payload, _ = http(base + '/config/main', headers={'Authorization': 'Bearer ' + access})
    require(status == 200 and json.loads(payload)['data'].encode() == config['_main'].read_bytes(),
            'authenticated-fetch-does-not-match-saved-config')


def verify_routes(config, services, redirect_from=None):
    status, _, _ = http(origin(config, 'GITLAB') + '/users/sign_in')
    require(status == 200, 'gitlab-sign-in-not-ready')
    ready = json.loads(run([*DOCKER, 'exec', 'system_gitlab_1', 'curl', '-fsS', '--max-time', '10',
                           'http://127.0.0.1/-/readiness']))
    require(ready.get('status') == 'ok', 'gitlab-application-not-ready')
    registry = origin(config, 'GITLAB_REGISTRY')
    if config['GITLAB_REGISTRY_DOMAIN_MODE'] in ('0', '1') and ':' not in urllib.parse.urlsplit(registry).netloc:
        registry += ':5050'
    status, _, headers = http(registry + '/v2/')
    require(status == 401 and headers.get('WWW-Authenticate', '').startswith('Bearer '), 'registry-authentication-not-ready')
    if config['WIZARD_ENABLE'] == 'true':
        public = origin(config, 'WIZARD')
        status, body, _ = http(public + '/')
        require(status == 200, 'wizard-public-not-ready')
        networks = services['system_wizard_1']['NetworkSettings']['Networks'].values()
        addresses = [row['IPAddress'] for row in networks if row.get('IPAddress')]
        require(bool(addresses), 'wizard-container-network-missing')
        direct_status, direct_body, _ = http('http://' + addresses[0] + '/',
                                            headers={'Host': urllib.parse.urlsplit(public).netloc})
        require(direct_status == 200 and direct_body == body, 'public-host-does-not-route-to-wizard')
        if redirect_from:
            parsed = urllib.parse.urlsplit(redirect_from)
            require(parsed.scheme in ('http', 'https') and bool(parsed.netloc) and
                    not parsed.username and parsed.path in ('', '/') and not parsed.query and not parsed.fragment,
                    'invalid-redirect-origin')
            suffix = '/bootstrapper-routing-check?probe=1'
            status, _, headers = http(redirect_from.rstrip('/') + suffix)
            require(status in (301, 308) and headers.get('Location') == public + suffix,
                    'canonical-host-redirect-mismatch')


def runner_contacts(config, baseline, token_file):
    if not token_file:
        return {'checked': False, 'reason': 'no-operator-supplied-GitLab-API-token'}
    path = Path(token_file)
    require(path.is_file() and not path.is_symlink() and not (path.stat().st_mode & 0o077), 'GitLab-token-file-must-be-private')
    token = path.read_text().strip()
    require(bool(token), 'GitLab-token-file-is-empty')
    base = origin(config, 'GITLAB') + '/api/v4'
    def pages(route):
        result = []
        for page in range(1, 101):
            status, body, headers = http(base + route + ('&' if '?' in route else '?') +
                                         f'per_page=100&page={page}', headers={'PRIVATE-TOKEN': token})
            require(status == 200, 'GitLab-runner-API-permission-or-readiness')
            rows = json.loads(body)
            require(isinstance(rows, list), 'invalid-GitLab-runner-API-response')
            result.extend(rows)
            if not headers.get('X-Next-Page'):
                return result
        raise recovery.RecoveryError('GitLab-runner-API-pagination-limit')
    runners = pages('/runners/all')
    expected = set()
    for index in range(1, runner_count(config) + 1):
        raw = (config['_root'] / f'runners/runner/{index}/config/.runner_system_id').read_bytes()
        expected.add(hashlib.sha256(raw.strip()).hexdigest())
    require(len(expected) == runner_count(config), 'runner-manager-identities-not-unique')
    matched = {}
    started = datetime.datetime.fromisoformat(baseline['startedAt'])
    for runner in runners:
        require(isinstance(runner.get('id'), int), 'invalid-GitLab-runner-id')
        for manager in pages('/runners/' + str(runner['id']) + '/managers'):
            identity = hashlib.sha256(manager.get('system_id', '').encode()).hexdigest()
            if identity in expected:
                contact = manager.get('contacted_at')
                require(contact is not None and manager.get('status') == 'online' and
                        datetime.datetime.fromisoformat(contact.replace('Z', '+00:00')) >= started,
                        'runner-manager-contact-not-fresh')
                matched[identity] = {'identitySha256': identity, 'runnerId': runner['id'], 'contactedAt': contact}
    require(set(matched) == expected, 'expected-runner-managers-not-online')
    return {'checked': True, 'online': len(matched), 'contactsAfterStart': True}


def verify(config, baseline, checkout, token_file=None, redirect_from=None):
    assert_baseline(config, baseline)
    require(run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).decode().strip() == baseline['hostToolsRevision'] and
            not run(['git', '-C', str(checkout), 'status', '--porcelain']).strip(), 'host-tools-checkout-changed')
    manifest = recovery.load_manifest(config['_root'] / 'recovery', checkout)
    services = inspect_services(config)
    verify_images(config, manifest, services)
    mounts = verify_mounts(config, services)
    verify_routes(config, services, redirect_from)
    verify_sync(config)
    runners = runner_contacts(config, baseline, token_file)
    tls = any(config.get(key + '_DOMAIN_MODE') in ('2', '3') for key in ('WIZARD', 'SYNC', 'GITLAB', 'GITLAB_REGISTRY'))
    if tls:
        require(Path('/etc/letsencrypt').resolve(strict=True) == config['_root'] / 'host/letsencrypt',
                'certificate-state-is-not-on-volume')
        require(run(['systemctl', 'is-active', 'certbot.timer']).strip() == b'active', 'certificate-renewal-timer-inactive')
        next_run = run(['systemctl', 'show', 'certbot.timer', '--property=NextElapseUSecRealtime', '--value']).strip()
        require(next_run not in (b'', b'n/a'), 'certificate-renewal-not-scheduled')
    for name in ('.wizard-image-recovery.lock', '.wizard-image-recovery.pending'):
        require(not (config['_root'] / 'configuration' / name).exists(), 'private-registry-recovery-cleanup-pending')
    assert_baseline(config, baseline)
    final = inspect_services(config)
    require(all(final[name]['Id'] == row['Id'] and final[name]['State']['StartedAt'] == row['State']['StartedAt']
                for name, row in services.items()), 'services-replaced-during-verification')
    return {'passed': True, 'at': now(), 'sourceCommit': manifest['sourceCommit'],
            'sourceTree': manifest['sourceTree'], 'hostToolsRevision': baseline['hostToolsRevision'],
            'runningCoreServices': len(services), 'persistentMountCount': mounts,
            'configurationUnchanged': True, 'authenticatedFetchMatchesSavedBytes': True,
            'cubeExact': True, 'runnerManagers': runners, 'renewalTimerChecked': tls}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['baseline', 'check'])
    parser.add_argument('--persistence-env', required=True)
    parser.add_argument('--baseline', help='Required for check; baseline does not change after capture.')
    parser.add_argument('--output', required=True)
    parser.add_argument('--timeout', type=int, default=0, help='Bounded readiness wait in seconds.')
    parser.add_argument('--gitlab-token-file', help='Optional private operator API token; verifies fresh manager contacts.')
    parser.add_argument('--redirect-from', help='Optional old origin that must redirect to configured Wizard origin.')
    args = parser.parse_args()
    require(0 <= args.timeout <= 3600, 'invalid-readiness-timeout')
    output = Path(args.output).resolve()
    require(output != HERE.parent and HERE.parent not in output.parents, 'receipts-must-be-outside-checkout')
    config = settings(args.persistence_env)
    checkout = HERE.parent
    if args.operation == 'baseline':
        require(not Path(args.output).exists(), 'baseline-already-exists')
        write_private(args.output, capture(config, checkout))
        print('Pre-start baseline captured.')
        return
    require(bool(args.baseline), 'pre-start-baseline-required')
    baseline = json.loads(Path(args.baseline).read_bytes())
    deadline = time.monotonic() + args.timeout
    while True:
        try:
            result = verify(config, baseline, checkout, args.gitlab_token_file, args.redirect_from)
            write_private(args.output, result)
            print('Runtime verification passed.')
            return
        except Exception as error:
            label = str(error) if isinstance(error, recovery.RecoveryError) else type(error).__name__
            write_private(args.output, {'passed': False, 'at': now(), 'failedCheck': label})
            if time.monotonic() >= deadline:
                raise recovery.RecoveryError(label) from None
            time.sleep(min(10, max(0, deadline - time.monotonic())))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Verification failed: ' + (str(error) if isinstance(error, recovery.RecoveryError)
                                          else type(error).__name__), file=__import__('sys').stderr)
        raise SystemExit(1)
