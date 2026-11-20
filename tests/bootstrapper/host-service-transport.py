"""Real pipe peers: stalled transport is bounded without timing native work."""
import importlib.util
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('host_service_transport', ROOT / 'bootstrapper/host_service.py')
host_service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_service)


class PortError(RuntimeError):
    pass


class Transport(unittest.TestCase):
    def invoke(self, script, dispatch=lambda *_: None, request=None, timeout=0.25):
        real_popen = subprocess.Popen
        children = []

        def launch(_args, **kwargs):
            child = real_popen([sys.executable, '-u', '-c', script], **kwargs)
            children.append(child)
            return child

        try:
            with patch.object(host_service.subprocess, 'Popen', launch):
                return host_service.invoke('fixture.js', request or {}, dispatch, PortError,
                                           peer_timeout=timeout)
        finally:
            self.assertEqual(len(children), 1)
            self.assertIsNotNone(children[0].poll(), 'peer must be killed/reaped before returning')
            self.assertTrue(children[0].stdin.closed)
            self.assertTrue(children[0].stdout.closed)

    def test_stalled_reader_and_partial_writer_are_bounded(self):
        for script, request in [
            ('import time; time.sleep(30)', {'large': 'x' * 1000000}),
            ('import sys,time; sys.stdin.readline(); sys.stdout.write("{"); sys.stdout.flush(); time.sleep(30)', {}),
        ]:
            with self.subTest(script=script), self.assertRaisesRegex(PortError, 'host-native-port-timeout'):
                self.invoke(script, request=request)

    def test_callback_can_exceed_peer_deadline(self):
        script = '''import sys,json
sys.stdin.readline()
print(json.dumps({'method':'copy','args':[]}), flush=True)
response=json.loads(sys.stdin.readline())
print(json.dumps({'complete':True,'value':response['value']}), flush=True)
'''
        def copy(*_):
            time.sleep(0.5)
            return 'retained'
        self.assertEqual(self.invoke(script, copy), 'retained')

    def test_native_exception_identity_survives_roundtrip(self):
        script = '''import sys,json
sys.stdin.readline()
print(json.dumps({'method':'probe','args':[]}), flush=True)
response=json.loads(sys.stdin.readline())
print(json.dumps({'complete':True,'error':response['error']}), flush=True)
'''
        original = OSError('private native detail')
        def fail(*_):
            raise original
        try:
            self.invoke(script, fail)
        except OSError as error:
            self.assertIs(error, original)
        else:
            self.fail('native exception missing')

    def test_cancelled_callback_reaps_waiting_peer(self):
        def cancel(*_):
            raise KeyboardInterrupt()
        script = 'import sys,json,time; sys.stdin.readline(); print(json.dumps({"method":"copy","args":[]}),flush=True); time.sleep(30)'
        with self.assertRaises(KeyboardInterrupt):
            self.invoke(script, cancel)

    def test_sigterm_reaps_peer_and_restores_handler(self):
        before = signal.getsignal(signal.SIGTERM)
        def cancel(*_):
            os.kill(os.getpid(), signal.SIGTERM)
        script = 'import sys,json,time; sys.stdin.readline(); print(json.dumps({"method":"copy","args":[]}),flush=True); time.sleep(30)'
        with self.assertRaises(KeyboardInterrupt):
            self.invoke(script, cancel)
        self.assertEqual(signal.getsignal(signal.SIGTERM), before)

    def test_complete_message_does_not_allow_stuck_exit(self):
        script = 'import sys,time; sys.stdin.readline(); print("{\\"complete\\":true}",flush=True); time.sleep(30)'
        with self.assertRaisesRegex(PortError, 'host-native-port-timeout'):
            self.invoke(script)


if __name__ == '__main__':
    unittest.main()
