#!/usr/bin/env python3
"""Own and bound a host command group across coordinator process interruption."""
import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True


def identity(pid):
    try:
        fields = Path('/proc/' + str(pid) + '/stat').read_text().rpartition(')')[2].split()
        return None if fields[0] == 'Z' else fields[19]
    except FileNotFoundError:
        return None


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


def publish(path, data):
    descriptor, filename = tempfile.mkstemp(prefix='.host-child-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(data, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(filename, path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', action='store_true')
    parser.add_argument('--start-fd', type=int)
    parser.add_argument('--guard-fd', type=int)
    parser.add_argument('--journal')
    parser.add_argument('--operation')
    parser.add_argument('--timeout', type=float, default=300)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        raise RuntimeError('host-child-command-required')
    if args.worker:
        # No mutating command runs until its PID/start/PGID is durable. If the
        # guardian dies before acknowledging, EOF/timeout exits this worker.
        ready, _, _ = select.select([args.start_fd], [], [], 15)
        if not ready or os.read(args.start_fd, 1) != b'G':
            raise SystemExit(125)
        os.close(args.start_fd)
        os.execvpe(command[0], command, os.environ)
    if args.guard_fd is None or not args.journal or not args.operation or not 0 < args.timeout <= 1800:
        raise RuntimeError('host-child-owner-inputs-required')
    os.fstat(args.guard_fd)  # Inherited lease FD remains open until every child ends.
    path = Path(args.journal)
    record = {'format': 'system-host-child-v1', 'operation': args.operation, 'phase': 'guardian-started',
              'guardianPid': os.getpid(), 'guardianStart': identity(os.getpid()),
              'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    publish(path, record)
    permit_read, permit_write = os.pipe()
    child, child_start = None, None
    canceled = False
    def stop_group(*unused):
        if not child or not group_live(child.pid):
            return
        current = identity(child.pid)
        if current is not None and child_start is not None and current != child_start:
            raise RuntimeError('host-child-group-leader-identity-changed')
        marker = ('SYSTEM_CONTROLLER_CHILD_OWNER=' + args.operation).encode()
        for path in Path('/proc').glob('[0-9]*/stat'):
            try:
                fields = path.read_text().rpartition(')')[2].split()
                if int(fields[2]) != child.pid or fields[0] == 'Z':
                    continue
                environment = (path.parent / 'environ').read_bytes().split(b'\0')
                if marker not in environment:
                    raise RuntimeError('host-child-group-ownership-changed')
            except (FileNotFoundError, ProcessLookupError):
                continue
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    def terminate(*unused):
        nonlocal canceled
        canceled = True
        stop_group()
    for name in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(name, terminate)
    try:
        payload = sys.stdin.buffer.read()
        if canceled:
            raise RuntimeError('host-child-canceled-before-start')
        child = subprocess.Popen([sys.executable, __file__, '--worker', '--start-fd', str(permit_read), '--', *command],
                                 pass_fds=(permit_read,), start_new_session=True,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env=dict(os.environ, SYSTEM_CONTROLLER_CHILD_OWNER=args.operation))
        child_start = identity(child.pid)
        os.close(permit_read)
        permit_read = -1
        record.update(phase='running', childPid=child.pid, childStart=child_start, childPgid=child.pid)
        publish(path, record)
        if canceled:
            raise RuntimeError('host-child-canceled-before-exec')
        os.write(permit_write, b'G')
        os.close(permit_write)
        permit_write = -1
        try:
            output, error = child.communicate(input=payload, timeout=args.timeout)
            code = child.returncode
        except subprocess.TimeoutExpired:
            stop_group()
            output, error = child.communicate(timeout=10)
            code = 124
        finally:
            # A successful Compose parent must not leave a plugin descendant
            # mutating Docker after its watchdog releases the shared guard.
            stop_group()
            until = time.monotonic() + 10
            while group_live(child.pid) and time.monotonic() < until:
                stop_group()
                time.sleep(0.02)
            if group_live(child.pid):
                raise RuntimeError('owned-host-command-group-still-running')
        record.update(phase='completed', exitCode=code)
        publish(path, record)
        sys.stdout.buffer.write(output)
        sys.stderr.buffer.write(error)
        return code if code >= 0 else 128 - code
    finally:
        if permit_read >= 0:
            os.close(permit_read)
        if permit_write >= 0:
            os.close(permit_write)
        if child and child.poll() is None:
            stop_group()
            child.wait(timeout=10)
        os.close(args.guard_fd)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('Owned host command failed; inspect its private child journal.', file=sys.stderr)
        raise SystemExit(1)
