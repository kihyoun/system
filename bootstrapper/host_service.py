"""Framed native adapter transport for repository-owned Nest host services."""
import atexit
import ctypes
import json
import math
import os
import select
import signal
import threading
import time
from pathlib import Path
import subprocess


class PeerChannel:
    """Deadline covers one local pipe exchange, never the native callback."""
    limit = 16 * 1024 ** 2

    def __init__(self, child, timeout, error_type):
        self.child, self.timeout, self.error_type = child, timeout, error_type
        self.pending = bytearray()
        for stream in (child.stdin, child.stdout):
            os.set_blocking(stream.fileno(), False)

    def ready(self, stream, writing, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise self.error_type('host-native-port-timeout')
        readable, writable, _ = select.select([] if writing else [stream],
                                              [stream] if writing else [], [], remaining)
        if not (writable if writing else readable):
            raise self.error_type('host-native-port-timeout')

    def send(self, value):
        data = (json.dumps(value) + '\n').encode()
        if len(data) > self.limit:
            raise self.error_type('host-native-port-frame-too-large')
        deadline = time.monotonic() + self.timeout
        offset = 0
        while offset < len(data):
            self.ready(self.child.stdin, True, deadline)
            try:
                offset += os.write(self.child.stdin.fileno(), data[offset:offset + 65536])
            except BlockingIOError:
                continue
            except BrokenPipeError:
                raise self.error_type('host-native-port-disconnected') from None

    def receive(self):
        deadline = time.monotonic() + self.timeout
        while b'\n' not in self.pending:
            self.ready(self.child.stdout, False, deadline)
            try:
                chunk = os.read(self.child.stdout.fileno(), 65536)
            except BlockingIOError:
                continue
            if not chunk:
                raise self.error_type('host-native-port-disconnected')
            self.pending.extend(chunk)
            if len(self.pending) > self.limit:
                raise self.error_type('host-native-port-frame-too-large')
        line, _, remainder = self.pending.partition(b'\n')
        self.pending = bytearray(remainder)
        return json.loads(line)


_WORKER_ENTRIES = frozenset({
    'cold-maintenance-entry.js', 'promotion-sequence-entry.js',
    'controller-update-sequence-entry.js', 'controller-rollback-sequence-entry.js',
    'public-upgrade-plan-entry.js', 'public-upgrade-apply-entry.js',
})
_peers = {}
_guard = threading.RLock()


def _parent_death(parent):
    if ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0) != 0 or os.getppid() != parent:
        os._exit(1)


def _close(peer):
    child, _, owner, _ = peer
    if owner != os.getpid():
        return
    child.stdin.close()
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
    child.stdout.close()


def close():
    with _guard:
        for peer in list(_peers.values()):
            _close(peer)
        _peers.clear()


atexit.register(close)


def invoke(entry, request, dispatch, error_type, active_error=None, *, peer_timeout=30):
    # A caller's ports are valid only for this request. A cached peer retains no
    # Python dispatch closure; nested operations use their own entry worker.
    with _guard:
        return _invoke(entry, request, dispatch, error_type, active_error, peer_timeout)


def _invoke(entry, request, dispatch, error_type, active_error, peer_timeout):
    if not math.isfinite(peer_timeout) or peer_timeout <= 0:
        raise error_type('invalid-host-native-peer-timeout')
    retained = Path('/opt/system-bootstrapper-runtime/bin/node')
    node = str(retained.resolve()) if retained.is_file() else 'node'
    filename = str(Path(__file__).resolve().parent.parent / 'operations/dist/host' / entry)
    cached = entry in _WORKER_ENTRIES
    key = (os.getpid(), node, filename)
    context = (os.getcwd(), tuple(sorted(os.environ.items())))
    peer = _peers.pop(key, None) if cached else None
    if peer and (peer[0].poll() is not None or peer[3] != context):
        _close(peer)
        peer = None
    if peer is None:
        parent = os.getpid()
        child = subprocess.Popen([node, filename, *(['--worker'] if cached else [])],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0,
            preexec_fn=lambda: _parent_death(parent))
        peer = (child, PeerChannel(child, peer_timeout, error_type), parent, context)
    child, channel, _, _ = peer
    channel.timeout, channel.error_type = peer_timeout, error_type
    healthy = False
    native_error = None
    handlers = {}
    def interrupt(signum, frame):
        raise KeyboardInterrupt()
    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM, signal.SIGHUP):
            previous = signal.getsignal(signum)
            if previous == signal.SIG_DFL:
                handlers[signum] = previous
                signal.signal(signum, interrupt)
    try:
        channel.send(request)
        while True:
            message = channel.receive()
            if message.get('complete'):
                if not cached or message.get('error'):
                    try:
                        child.wait(timeout=min(peer_timeout, 10))
                    except subprocess.TimeoutExpired:
                        raise error_type('host-native-port-timeout') from None
                if message.get('error'):
                    if native_error and message['error'] == native_error[0]:
                        raise native_error[1]
                    raise (active_error if active_error and message.get('activeJobs') else error_type)(message['error'])
                if child.returncode:
                    raise error_type('host-service-runtime-failed')
                if channel.pending:
                    raise error_type('host-native-port-unexpected-frame')
                healthy = cached
                return message.get('value')
            # This callback owns its operation budget (possibly hours for a copy).
            # Start a fresh peer deadline only after it returns.
            try:
                response = {'value': dispatch(message.get('method'), message.get('args', []))}
            except Exception as error:
                code = str(error) if isinstance(error, error_type) else 'host-native-port-failed'
                native_error = (code, error)
                response = {'error': code}
            channel.send(response)
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
        if healthy:
            previous = _peers.pop(key, None)
            if previous:
                _close(previous)
            _peers[key] = peer
        else:
            _peers.pop(key, None)
            if child.poll() is None:
                child.kill()
            _close(peer)
