#!/usr/bin/env bash
# Thin fresh-host entry point. Python 3 is included in standard Ubuntu 24.04.
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  printf 'Quickstart requires the standard Ubuntu Python 3 runtime. Install python3, then retry.\n' >&2
  exit 1
fi
python3 - <<'SYSTEM_QUICKSTART_PY'
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'kihyoun/system'  # Replaced for the accepted public mirror.
ACCEPTED_RELEASE_TAG = None  # Replaced only in the accepted public release asset.
CHECKOUT = Path('/opt/system-bootstrapper')
LIVE = Path('/var/lib/system-bootstrapper/platform')
SELECTOR = Path('/etc/system-bootstrapper/persistence.env')
ALLOWED_HOSTS = {'api.github.com', 'github.com', 'raw.githubusercontent.com',
                 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}


class QuickstartError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise QuickstartError(message)


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, target):
        validate_url(target)
        return super().redirect_request(request, fp, code, message, headers, target)


def validate_url(value):
    url = urllib.parse.urlsplit(value)
    require(url.scheme == 'https' and url.hostname in ALLOWED_HOSTS and url.port in (None, 443)
            and not url.username and not url.password and not url.fragment, 'Unapproved public download origin.')
    return value


def download(value):
    validate_url(value)
    request = urllib.request.Request(value, headers={'User-Agent': 'System-Bootstrapper-Quickstart',
                                                    'Accept': 'application/vnd.github+json'})
    with urllib.request.build_opener(PublicRedirect()).open(request, timeout=30) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    require(len(data) <= 8 * 1024 * 1024, 'Public release input is too large.')
    return data


def command(arguments, timeout=1800):
    try:
        subprocess.run(arguments, check=True, timeout=timeout)
    except (subprocess.SubprocessError, OSError):
        raise QuickstartError('Native installation step failed: ' + Path(arguments[0]).name +
                              '. Preserve the selected checkout and state; use the full installation guide.') from None


def preflight():
    require(os.geteuid() == 0, 'Run the one-command Quickstart with sudo/root access.')
    os_release = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            os_release[key] = value.strip('"')
    require(os_release.get('ID') == 'ubuntu' and os_release.get('VERSION_ID') in ('24.04', '26.04')
            and platform.machine() == 'x86_64', 'Quickstart supports Ubuntu 24.04 / 26.04 LTS amd64 only.')
    # An 8 GiB guest commonly reports less after kernel/firmware reservations.
    require(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') >= 8 * 1024 ** 3 - 512 * 1024 ** 2,
            'Quickstart requires an 8 GiB-class host (at least 7.5 GiB reported RAM).')
    require(shutil.disk_usage('/var/lib').free >= 40 * 1024 ** 3, 'Quickstart requires 40 GiB free on the live-data filesystem.')
    require(shutil.disk_usage('/opt').free >= 1024 ** 3, 'Quickstart requires 1 GiB free for source checkout.')
    for target in (CHECKOUT, LIVE, SELECTOR, Path('/etc/system-bootstrapper'),
                   Path('/var/lib/system-bootstrapper'), Path('/system')):
        require(not target.exists() and not target.is_symlink(),
                'Existing installation or retained state detected at ' + str(target) +
                '. Use the documented installation, upgrade or recovery path; nothing was overwritten.')
    for port in (80, 443):
        with socket.socket() as probe:
            try:
                probe.bind(('0.0.0.0', port))
            except OSError:
                raise QuickstartError('Port ' + str(port) + ' is already in use. Preserve existing services and use the full guide.') from None
    if shutil.which('docker'):
        for arguments in (['container', 'ls', '--all', '--filter', 'name=^/system_', '--format', '{{.ID}}'],
                          ['volume', 'ls', '--filter', 'name=^system_', '--format', '{{.Name}}']):
            result = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *arguments],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
            require(result.returncode == 0 and not result.stdout.strip(),
                    'Existing System Docker state or unavailable daemon detected; use the full installation guide.')


def metadata():
    selector = 'tags/' + ACCEPTED_RELEASE_TAG if ACCEPTED_RELEASE_TAG else 'latest'
    release = json.loads(download('https://api.github.com/repos/' + REPOSITORY + '/releases/' + selector))
    tag = release.get('tag_name', '')
    require(re.fullmatch(r'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', tag)
            and (ACCEPTED_RELEASE_TAG is None or tag == ACCEPTED_RELEASE_TAG)
            and release.get('draft') is False and release.get('prerelease') is False,
            'A published stable accepted release is required.')
    name = 'system-release-' + tag + '.json'
    def asset(filename):
        rows = [row for row in release.get('assets', []) if row.get('name') == filename]
        require(len(rows) == 1 and rows[0].get('browser_download_url') ==
                'https://github.com/' + REPOSITORY + '/releases/download/' + tag + '/' + filename,
                'Expected versioned public release asset is missing.')
        return download(rows[0]['browser_download_url'])
    raw = asset(name)
    require(asset(name + '.sha256').decode() == hashlib.sha256(raw).hexdigest() + '  ' + name + '\n',
            'Public release metadata checksum mismatch.')
    value = json.loads(raw)
    require(value.get('format') == 'system-accepted-release-v1' and value.get('tag') == tag
            and value.get('version') == tag[1:] and value.get('platform') == 'linux/amd64'
            and value.get('acceptance', {}).get('controllerWizardSameAttempt') is True
            and value.get('acceptance', {}).get('requiredChecksPassed') is True,
            'Accepted public source/image metadata required.')
    source = value.get('source', {})
    require(source.get('repository') == 'https://github.com/' + REPOSITORY + '.git'
            and isinstance(source.get('wizardRepository'), str)
            and re.fullmatch(r'https://github\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+\.git', source['wizardRepository'])
            and all(re.fullmatch(r'[a-f0-9]{40}', source.get(key, '')) for key in ('revision', 'tree', 'wizardRevision')),
            'Exact public source identities are required.')
    for role in ('controller', 'wizard'):
        require(re.fullmatch(r'(?:docker\.io/)?[a-z0-9_-]+/[a-z0-9._-]+@sha256:[a-f0-9]{64}',
                             value.get('images', {}).get(role, {}).get('reference', '')),
                'Immutable public controller/Wizard images are required.')
    require(re.fullmatch(r'[a-f0-9]{64}', value.get('quickstart', {}).get('hostInstallerSha256', '')),
            'Accepted native host installer checksum required.')
    return value


def wait_for_wizard(timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1/configuration', timeout=5) as response:
                ready = response.status == 200 and b'<html' in response.read(1024 * 1024).lower()
            try:
                urllib.request.urlopen('http://127.0.0.1/sync/status', timeout=5)
            except urllib.error.HTTPError as error:
                if ready and error.code == 401:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(2)
    raise QuickstartError('Startup was requested but Wizard/Sync readiness timed out. Preserve state and inspect native Docker logs; do not rerun as a fresh install.')


def install():
    preflight()
    print('Selecting the accepted public release and exact source/image pair...', flush=True)
    selected = metadata()
    source = selected['source']
    with tempfile.TemporaryDirectory(prefix='system-quickstart-') as temporary:
        native = Path(temporary) / 'install.sh'
        raw = download('https://raw.githubusercontent.com/' + REPOSITORY + '/' + source['revision'] + '/bootstrapper/install.sh')
        require(hashlib.sha256(raw).hexdigest() == selected['quickstart']['hostInstallerSha256'], 'Native host installer source mismatch.')
        native.write_bytes(raw)
        print('Installing native host dependencies. Package downloads and image pulls can take several minutes...', flush=True)
        command(['bash', str(native)])
    # Recheck source destination after dependency setup. Never replace any path.
    require(not CHECKOUT.exists() and not CHECKOUT.is_symlink(), 'Checkout appeared during setup; preserving it.')
    command(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-checkout', '--', source['repository'], str(CHECKOUT)])
    command(['git', '-C', str(CHECKOUT), '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', source['revision']])
    tree = subprocess.check_output(['git', '-C', str(CHECKOUT), 'rev-parse', 'HEAD^{tree}']).decode().strip()
    gitlink = subprocess.check_output(['git', '-C', str(CHECKOUT), 'ls-tree', 'HEAD', 'wizard']).decode().strip()
    require(tree == source['tree'] and gitlink == '160000 commit ' + source['wizardRevision'] + '\twizard', 'Accepted source tree/gitlink mismatch.')
    mapping = subprocess.check_output(['git', '-C', str(CHECKOUT), 'config', '--file', '.gitmodules', '--get', 'submodule.wizard.url']).decode().strip()
    require(mapping == source['wizardRepository'], 'Accepted Wizard repository mapping mismatch.')
    command(['git', '-C', str(CHECKOUT), '-c', 'core.hooksPath=/dev/null', 'submodule', 'update', '--init', '--recursive'])
    # The native installer enforces clean source, fresh live state, exclusive
    # initialization and exact pulled-image labels before any service startup.
    with tempfile.TemporaryDirectory(prefix='system-release-metadata-') as temporary:
        manifest = Path(temporary) / 'release.json'
        manifest.write_text(json.dumps(selected))
        manifest.chmod(0o600)
        command(['python3', str(CHECKOUT / 'bootstrapper/install-release.py'),
                 '--controller', selected['images']['controller']['reference'],
                 '--wizard', selected['images']['wizard']['reference'], '--release-metadata', str(manifest)])
    wait_for_wizard()
    print('\nWizard ready: http://127.0.0.1/configuration')
    print('For a remote host, open a protected tunnel on YOUR workstation:')
    print('  ssh -N -L 8080:127.0.0.1:80 <your-user>@<your-host>')
    print('Then open http://127.0.0.1:8080/configuration; use Sync address http://127.0.0.1:8080/sync')
    print('Read the unique first-access username/password locally on the host:')
    print('  sudo cat /var/lib/system-bootstrapper/platform/configuration/sync-auth.env')
    print('Use the tunnel before entering credentials. The initial HTTP service has no public HTTPS.')
    print('Continue configuration in the Wizard; choose GitLab host ports compatible with your SSH service.')
    print('Full installation, DNS/HTTPS, recovery and upgrade: ' + selected['documentation']['quickstart'])


def main():
    try:
        require(os.geteuid() == 0, 'Run this installer with sudo/root access.')
        descriptor = os.open('/run/system-bootstrapper-quickstart.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'a') as guard:
            os.fchmod(guard.fileno(), 0o600)
            try:
                fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise QuickstartError('Another Quickstart is running.') from None
            install()
        return 0
    except (QuickstartError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('Quickstart: ' + (str(error) if isinstance(error, QuickstartError) else
                               'Public input or native operation failed. Preserve existing state and consult the full guide.'), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
SYSTEM_QUICKSTART_PY
