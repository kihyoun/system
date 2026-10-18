#!/usr/bin/env python3
"""Explicitly leased, disposable cold/warm template build measurements."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

from collect import Collector, summary, timestamp

NODE = 'node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f'
NGINX = 'nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5'
BUILDKIT = 'moby/buildkit:buildx-stable-1@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea'


def docker(*args, timeout=30):
    try:
        result = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *args],
                                check=True, capture_output=True, text=True, timeout=timeout)
        if len(result.stdout) + len(result.stderr) > 2_000_000:
            raise RuntimeError('Docker response limit exceeded.')
        return result.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        raise RuntimeError('Bounded benchmark Docker command failed.') from None


def manifest(directory):
    result = []
    for file in sorted(directory.rglob('*')):
        if file.is_symlink():
            raise RuntimeError('Benchmark inputs must not contain links.')
        if file.is_file():
            if file.name in ('.env', '.docker.env', '.npmrc', '.netrc') or file.stat().st_size > 4_000_000:
                raise RuntimeError('Unexpected private or oversized benchmark input.')
            result.append({'path': str(file.relative_to(directory)),
                           'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
    return result


def checkpoint(output, value):
    temporary = output / 'operation.tmp'
    with temporary.open('w') as target:
        os.chmod(temporary, 0o600)
        json.dump(value, target)
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(output / 'operation.json')
    descriptor = os.open(output, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def build(builder, context, tag, phase, operation, revision, collector, output, work_deadline):
    started = timestamp()
    command = ['docker', '--host=unix:///var/run/docker.sock', 'buildx', 'build',
               '--builder', builder, '--load', '--provenance=false', '--progress=plain',
               '--label', 'system.resource.benchmark.operation=' + operation,
               '--label', 'org.opencontainers.image.revision=' + revision,
               '--label', 'system.resource.benchmark.phase=' + phase, '-t', tag, str(context)]
    begin = time.monotonic()
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = bytearray()
    overflow = threading.Event()

    def consume():
        while chunk := process.stdout.read(65536):
            if len(log) + len(chunk) > 2_000_000:
                overflow.set()
            else:
                log.extend(chunk)

    reader = threading.Thread(target=consume, daemon=True)
    reader.start()
    finished = {}
    def wait():
        process.wait()
        finished.update(monotonic=time.monotonic(), timestamp=timestamp())
    waiter = threading.Thread(target=wait, daemon=True)
    waiter.start()
    samples = []
    try:
        while process.poll() is None:
            if time.monotonic() - begin > 240 or time.time() >= work_deadline or overflow.is_set():
                raise RuntimeError('Build exceeded its four-minute/output bound.')
            if len(samples) < 30:
                samples.append(collector.sample())
            else:
                time.sleep(0.25)
        waiter.join(timeout=3)
        elapsed = finished['monotonic'] - begin
        reader.join(timeout=3)
        (output / (phase + '.log')).write_bytes(log)
        if process.returncode != 0 or overflow.is_set() or reader.is_alive():
            raise RuntimeError('Template build failed; inspect bounded public-input build log.')
        return {'phase': phase, 'startedAt': started, 'finishedAt': finished['timestamp'],
                'commandWallSeconds': round(elapsed, 3),
                'cache': 'fresh-owned-builder-empty-cache' if phase == 'cold' else 'same-builder-dependency-cache-source-rebuild',
                'samples': samples, 'summary': summary(samples)}
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=['react', 'angular'], required=True)
    parser.add_argument('--templates', type=Path, required=True)
    parser.add_argument('--source-revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--lease-deadline-epoch', type=float)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.source_revision):
        parser.error('Use the exact archived System source revision.')
    source = args.templates / args.case
    dockerfile = (source / 'Dockerfile').read_text()
    if NODE not in dockerfile or NGINX not in dockerfile or 'RUN npm ci' not in dockerfile:
        raise RuntimeError('Expected the reviewed locked template recipe.')
    package = json.loads((source / 'package.json').read_text())
    lock = json.loads((source / 'package-lock.json').read_text())
    if lock.get('lockfileVersion') != 3:
        raise RuntimeError('Expected the committed npm lockfile.')
    plan = {'version': 1, 'case': args.case, 'systemSourceRevision': args.source_revision,
            'nodeImage': NODE, 'nginxImage': NGINX, 'buildkitImage': BUILDKIT,
            'builderMemoryBytes': 4 * 1024 ** 3, 'builderCpus': 2,
            'candidateMemoryBytes': 128 * 1024 ** 2, 'candidateCpus': 0.5,
            'maxPhaseSeconds': 240, 'maxLogBytesPerPhase': 2_000_000,
            'package': package, 'inputs': manifest(source)}
    if not args.execute:
        print(json.dumps(plan, indent=2))
        return
    if os.environ.get('SYSTEM_RESOURCE_BENCHMARK_APPROVED') != '1':
        raise RuntimeError('Obtain the coordinator resource lease before --execute.')
    if any(os.environ.get(key) for key in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']):
        raise RuntimeError('Use the native local daemon with no remote Docker overrides.')
    if args.lease_deadline_epoch is None or not 75 < args.lease_deadline_epoch - time.time() <= 600:
        raise RuntimeError('Provide the shared two-case lease deadline, within 600 seconds and with cleanup reserve.')
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    operation = uuid.uuid4().hex
    builder = 'resource-' + operation
    tags, candidate = [], None
    report = {'plan': plan, 'operation': operation, 'createdAt': timestamp(), 'builds': [], 'cleanup': 'pending'}
    intent = {'operation': operation, 'builder': builder, 'tags': tags, 'candidateId': None,
              'candidateName': 'resource-candidate-' + operation, 'phase': 'reserved',
              'leaseDeadlineEpoch': args.lease_deadline_epoch}
    checkpoint(args.output, intent)
    collector = Collector(budget=12, maximum_containers=32)
    temporary = Path(tempfile.mkdtemp(prefix='system-resource-'))
    failure = None
    try:
        context = temporary / 'context'
        shutil.copytree(source, context)
        docker('buildx', 'create', '--name', builder, '--driver', 'docker-container',
               '--driver-opt', 'memory=4g', '--driver-opt', 'cpu-period=100000',
               '--driver-opt', 'cpu-quota=200000', '--driver-opt', 'image=' + BUILDKIT)
        for phase in ['cold', 'warm']:
            if time.time() >= args.lease_deadline_epoch - 60:
                raise RuntimeError('Shared benchmark lease reached its cleanup reserve.')
            if phase == 'warm':
                changed = context / ('src/App.tsx' if args.case == 'react' else 'src/app/app.ts')
                with changed.open('a') as target:
                    target.write('\n// Resource benchmark dependency-cache reuse.\n')
            tag = 'system-resource-benchmark:' + operation + '-' + phase
            tags.append(tag)
            intent['phase'] = phase
            checkpoint(args.output, intent)
            result = build(builder, context, tag, phase, operation, args.source_revision, collector, args.output,
                           args.lease_deadline_epoch - 60)
            result['contextManifest'] = manifest(context)
            report['builds'].append(result)
            (args.output / 'evidence.json').write_text(json.dumps(report, indent=2))
        image = json.loads(docker('image', 'inspect', '--format', '{{json .}}', tags[-1]))
        if image['Config']['Labels'].get('system.resource.benchmark.operation') != operation:
            raise RuntimeError('Benchmark image ownership changed.')
        intent['phase'] = 'candidate-create-intent'
        checkpoint(args.output, intent)
        candidate = docker('create', '--name', intent['candidateName'], '--network', 'none', '--memory', '128m', '--cpus', '0.5',
                           '--label', 'system.resource.benchmark.operation=' + operation, tags[-1])
        intent['candidateId'] = candidate
        checkpoint(args.output, intent)
        docker('start', candidate)
        for attempt in range(20):
            try:
                docker('exec', candidate, 'wget', '-q', '-T', '2', '-O', '/dev/null', 'http://127.0.0.1/', timeout=5)
                break
            except RuntimeError:
                if attempt == 19:
                    raise
                time.sleep(0.25)
        report['staticHttpSmoke'] = True
        report['builtImageId'] = image['Id']
    except BaseException as error:
        failure = error
    finally:
        cleanup_errors = []
        def clean(*args):
            remaining = args_deadline - time.time()
            if remaining < 1:
                raise RuntimeError('Lease ended; inspect durable operation checkpoint.')
            return docker(*args, timeout=min(6, remaining))
        args_deadline = args.lease_deadline_epoch
        if candidate is None and intent['phase'] == 'candidate-create-intent':
            try:
                found = clean('ps', '-aq', '--no-trunc', '--filter', 'label=system.resource.benchmark.operation=' + operation)
                if re.fullmatch('[a-f0-9]{64}', found):
                    candidate = found
            except RuntimeError:
                cleanup_errors.append('candidate-reconciliation')
        if candidate:
            try:
                row = json.loads(clean('inspect', '--format', '{{json .}}', candidate))
                if row['Id'] != candidate or row['Config']['Labels'].get('system.resource.benchmark.operation') != operation:
                    raise RuntimeError('Candidate ownership changed.')
                clean('rm', '-f', candidate)
            except RuntimeError:
                cleanup_errors.append('candidate')
        for tag in tags:
            try:
                if not clean('image', 'ls', '--filter', 'reference=' + tag, '--format', '{{.ID}}'):
                    continue
                row = json.loads(clean('image', 'inspect', '--format', '{{json .}}', tag))
                if row['Config']['Labels'].get('system.resource.benchmark.operation') != operation:
                    raise RuntimeError('Image ownership changed.')
                clean('image', 'rm', tag)
            except RuntimeError:
                cleanup_errors.append('image')
        try:
            clean('buildx', 'rm', '-f', builder)
        except RuntimeError:
            cleanup_errors.append('builder')
        shutil.rmtree(temporary)
        report['cleanup'] = 'passed' if not cleanup_errors else 'failed'
        report['cleanupErrors'] = cleanup_errors
        report['completedAt'] = timestamp()
        report['success'] = failure is None and not cleanup_errors
        (args.output / 'evidence.json').write_text(json.dumps(report, indent=2))
        intent['phase'] = 'complete' if report['success'] else 'failed'
        intent['cleanup'] = report['cleanup']
        checkpoint(args.output, intent)
        if failure is not None:
            raise failure
        if cleanup_errors:
            raise RuntimeError('Inspect operation-owned benchmark cleanup.')
    print(json.dumps({'case': args.case, 'success': report['success'], 'cleanup': report['cleanup']}))


if __name__ == '__main__':
    def cancel(_signum, _frame):
        raise KeyboardInterrupt('Benchmark cancelled; reconciling owned resources.')
    signal.signal(signal.SIGTERM, cancel)
    main()
