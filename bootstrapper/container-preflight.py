#!/usr/bin/env python3
"""Targeted host/MongoDB compatibility check; never changes the host or a database."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import uuid


def version(value):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', value)
    if not match:
        raise ValueError('Use an exact stable version such as 8.0.37.')
    return tuple(map(int, match.groups()))


def read_optional(path):
    try:
        return Path(path).read_text().strip()
    except FileNotFoundError:
        return ''


def host_facts(release, signature, cpuinfo, machine, ubuntu):
    # Ubuntu uname's ABI version is not the upstream stable patch level.
    upstream = re.match(r'^(\d+\.\d+\.\d+)', release)
    source = 'uname'
    if signature:
        match = re.fullmatch(r'Ubuntu (\S+) (\d+\.\d+\.\d+)', signature)
        package = re.fullmatch(r'(.+-\d+)(?:\.\d+)?(-[^ ]+)', match[1]) if match else None
        if not match or not package or package[1] + package[2] != release:
            upstream = None
            source = 'unrecognized-ubuntu-signature'
        else:
            upstream = re.match(r'^(\d+\.\d+\.\d+)$', match[2])
            source = 'ubuntu-version-signature'
    elif ubuntu:
        upstream = None
        source = 'missing-ubuntu-version-signature'
    flags = re.findall(r'^flags\s*:\s*(.*)$', cpuinfo, re.M)
    return {'kernelRelease': release, 'ubuntuVersionSignature': signature or None,
            'upstreamKernel': upstream[1] if upstream else None, 'kernelVersionSource': source,
            'architecture': machine, 'avx': bool(flags) and all('avx' in row.split() for row in flags)}


def assess(facts, mongo):
    findings = []
    def fail(code, message):
        findings.append({'code': code, 'message': message})
    if facts['architecture'] not in ('x86_64', 'amd64'):
        fail('unsupported-architecture', 'This preflight supports Linux x86_64 only; consult the MongoDB platform and CPU matrix for other architectures.')
    elif not facts['avx']:
        fail('cpu-avx-missing', 'MongoDB 5.0+ requires AVX exposed on every CPU. Check hardware and VM CPU feature passthrough; a kernel change does not supply AVX.')
    kernel = version(facts['upstreamKernel']) if facts['upstreamKernel'] else None
    if kernel is None:
        fail('kernel-version-unknown', 'Cannot establish the upstream kernel. Read /proc/version_signature on the Docker daemon host; do not infer an Ubuntu patch level from uname alone.')
    if mongo[:2] not in ((7, 0), (8, 0), (8, 3), (9, 0)):
        fail('mongodb-version-unreviewed', 'No compatibility rule is maintained for this MongoDB release line. Consult current vendor notes before selecting it.')
    elif kernel and mongo[0] >= 8 and kernel >= (6, 19, 0):
        if kernel < (7, 0, 14):
            fail('kernel-mongodb-incompatible', 'MongoDB 8/9 with Linux 6.19 through 7.0.13 is unsafe or refused at startup (TCMalloc/rseq). Select a vendor-supported combination; never disable its startup check.')
        else:
            # Conservative patch floors include the Ubuntu upstream-version exemption.
            floor = {(8, 0): (8, 0, 37), (8, 3): (8, 3, 16), (9, 0): (9, 0, 4)}[mongo[:2]]
            if mongo < floor:
                fail('mongodb-patch-required', 'This kernel requires a reviewed MongoDB patch including kernel/Ubuntu detection fixes: use at least ' + '.'.join(map(str, floor)) + ' for this line, then probe the exact image.')
    return findings


def probe(image, timeout):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]*@sha256:[a-f0-9]{64}', image):
        raise ValueError('Probe requires an immutable IMAGE@sha256:<64 lowercase hex> reference, already pulled on the daemon host.')
    name = 'system-compatibility-' + uuid.uuid4().hex
    command = ['docker', '--host', 'unix:///var/run/docker.sock', 'run', '--pull', 'never', '--rm',
               '--name', name, '--label', 'com.system-bootstrapper.compatibility-preflight=' + name,
               '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '--memory', '512m', '--cpus', '1', '--pids-limit', '64', '--log-driver', 'none',
               '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--entrypoint', 'mongod', image, '--version']
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        output = result.stdout.decode('utf-8', errors='replace')[:65536]
        if result.returncode == 0:
            match = re.search(r'\bdb version v(\d+\.\d+\.\d+)\b', output)
            if not match:
                return {'code': 'image-version-unrecognized', 'exitCode': 0}
            return {'code': 'image-probe-passed', 'exitCode': 0, 'mongodbVersion': match[1]}
        code = 'image-execution-failed'
        if '12257600' in output or re.search(r'(kernel.*(incompatib|unsupported)|incompatib.*kernel)', output, re.I):
            code = 'image-kernel-rejected'
        elif result.returncode in (132, -4):
            code = 'image-illegal-instruction'
        return {'code': code, 'exitCode': result.returncode,
                'message': 'Inspect the selected image/daemon privately. Kernel rejection, missing CPU features, image architecture, missing executable and Docker failures require different remedies.'}
    except subprocess.TimeoutExpired:
        return {'code': 'image-probe-timeout'}
    finally:
        # Inspect ownership even after a failed create; a name collision must
        # never remove another operator's container. No volumes are used.
        owned = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'container', 'inspect', '--format',
                                '{{index .Config.Labels \"com.system-bootstrapper.compatibility-preflight\"}}', name],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=False)
        if owned.returncode == 0 and owned.stdout.decode('utf-8', errors='replace').strip() == name:
            subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'rm', '-f', name],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mongodb-version', required=True, help='Exact selected stable server version, not an image tag guess')
    parser.add_argument('--image', help='Probe an already pulled digest with mongod --version; uses no database or network')
    parser.add_argument('--timeout', type=int, default=30)
    parser.add_argument('--planned-kernel', help='Explicit upstream X.Y.Z for planning only; no image probe')
    args = parser.parse_args()
    try:
        mongo = version(args.mongodb_version)
        if not 1 <= args.timeout <= 120:
            raise ValueError('Probe timeout must be from 1 to 120 seconds.')
        if platform.system() != 'Linux' or os.environ.get('DOCKER_HOST', 'unix:///var/run/docker.sock') != 'unix:///var/run/docker.sock' or os.environ.get('DOCKER_CONTEXT', 'default') != 'default':
            raise ValueError('Run on the Linux Docker daemon host using the local Unix socket, without a remote Docker context.')
        facts = host_facts(platform.release(), read_optional('/proc/version_signature'), read_optional('/proc/cpuinfo'),
                           platform.machine(), bool(re.search(r'^ID=[\"\']?ubuntu[\"\']?$', read_optional('/etc/os-release'), re.M)))
        if args.planned_kernel:
            version(args.planned_kernel)
            if args.image:
                raise ValueError('A running image cannot test a planned kernel. Boot and check the selected daemon host separately.')
            facts.update(upstreamKernel=args.planned_kernel, kernelVersionSource='operator-planned-upstream')
        findings = assess(facts, mongo)
        report = {'schemaVersion': 1, 'host': facts, 'mongodbVersion': args.mongodb_version,
                  'scope': 'planned-kernel' if args.planned_kernel else 'current-host', 'findings': findings}
        if args.image and not findings:
            report['image'] = args.image
            report['probe'] = probe(args.image, args.timeout)
            if report['probe'].get('mongodbVersion') not in (None, args.mongodb_version):
                findings.append({'code': 'image-version-mismatch', 'message': 'The executable version differs from the selected MongoDB version.'})
            if report['probe']['code'] != 'image-probe-passed':
                findings.append({'code': report['probe']['code'], 'message': 'Exact image execution failed; see probe diagnosis.'})
        report['ok'] = not findings
        print(json.dumps(report, indent=2))
        return 0 if report['ok'] else 1
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
