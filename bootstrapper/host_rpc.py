"""Lazy sequential bounded compatibility worker; no operation is retried on disconnect."""
import atexit
import ctypes
import json
import os
import select
import signal
import subprocess
import threading
import time

_LIMIT = 16 * 1024 * 1024
_workers = {}
_guard = threading.RLock()


def _parent_death(parent):
    # Linux host contract: a dead coordinator cannot leave a reusable worker.
    if ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0) != 0 or os.getppid() != parent:
        os._exit(1)


class Worker:
    def __init__(self, node, entry):
        parent = os.getpid()
        self.pid = parent
        self.child = subprocess.Popen([node, str(entry), '--worker'], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, preexec_fn=lambda: _parent_death(parent))
        os.set_blocking(self.child.stdin.fileno(), False)
        os.set_blocking(self.child.stdout.fileno(), False)
        self.sequence = 0
        self.pending = b''

    def close(self):
        if self.pid != os.getpid():
            return
        self.child.stdin.close()
        try:
            self.child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait()
        self.child.stdout.close()

    def request(self, operation, arguments, deadline):
        self.sequence += 1
        data = json.dumps({'id': self.sequence, 'operation': operation, 'arguments': arguments, 'environment': dict(os.environ),
            **({'deadline': deadline} if deadline is not None else {})}, default=str).encode() + b'\n'
        if len(data) > _LIMIT:
            raise RuntimeError('bounded-host-request-required')
        # Native services enforce their original command budgets; finite transport
        # bound also covers a peer that fails between callbacks. No retry occurs.
        remaining = 1800 if deadline is None else max(0, (deadline - time.time() * 1000) / 1000)
        until = time.monotonic() + remaining
        def ready(read=False):
            left = until - time.monotonic()
            if left <= 0 or not any(select.select([self.child.stdout] if read else [], [] if read else [self.child.stdin], [], left)[:2]):
                raise RuntimeError('host-operation-transport-timeout')
        while data:
            ready()
            try: data = data[os.write(self.child.stdin.fileno(), data):]
            except BlockingIOError: pass
        while b'\n' not in self.pending:
            ready(True)
            chunk = os.read(self.child.stdout.fileno(), 65536)
            if not chunk: raise RuntimeError('host-operation-transport-disconnected')
            self.pending += chunk
            if len(self.pending) > _LIMIT: raise RuntimeError('bounded-host-response-required')
        line, self.pending = self.pending.split(b'\n', 1)
        response = json.loads(line)
        if response.get('id') != self.sequence: raise RuntimeError('host-operation-response-mismatch')
        return response


def invoke(node, entry, operation, arguments, deadline=None):
    key = (os.getpid(), node, str(entry))
    with _guard:
        worker = _workers.get(key)
        if worker is None:
            worker = _workers[key] = Worker(node, entry)
        try:
            return worker.request(operation, arguments, deadline)
        except BaseException:
            _workers.pop(key, None)
            worker.close()
            raise


def close(entry_name=None):
    for key, worker in list(_workers.items()):
        if entry_name is None or os.path.basename(key[2]) == entry_name:
            _workers.pop(key, None)
            worker.close()


atexit.register(close)
