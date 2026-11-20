#!/usr/bin/env python3
"""Private host worker reuse, request identity and parent ownership."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bootstrapper'))
import host_rpc


class HostRpc(unittest.TestCase):
    def tearDown(self):
        host_rpc.close()

    def test_worker_reused_and_deadline_is_request_scoped(self):
        entry = ROOT / 'operations/dist/host/entry.js'
        def invoke(deadline=None):
            return host_rpc.invoke('node', entry, 'reference', ['docker.io/example/image@sha256:' + 'a' * 64], deadline)
        self.assertIn('value', invoke())
        worker = next(iter(host_rpc._workers.values()))
        pid = worker.child.pid
        self.assertIn('value', invoke())
        self.assertEqual(worker.child.pid, pid)
        self.assertEqual(worker.sequence, 2)
        lease_entry = entry.with_name('controller-lease-entry.js')
        self.assertIn('error', host_rpc.invoke('node', lease_entry, 'invalid', []))
        lease_worker = next(value for key, value in host_rpc._workers.items() if key[2] == str(lease_entry))
        host_rpc.close(lease_entry.name)
        self.assertIsNotNone(lease_worker.child.poll())
        self.assertIsNone(worker.child.poll())
        self.assertIn('value', invoke())
        with self.assertRaisesRegex(RuntimeError, 'transport-timeout'):
            invoke(time.time() * 1000 - 1)
        self.assertIsNotNone(worker.child.poll())
        self.assertIn('value', invoke())
        self.assertNotEqual(next(iter(host_rpc._workers.values())).child.pid, pid)

    def test_response_identity_mismatch_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            entry = Path(directory) / 'peer.js'
            entry.write_text('process.stdin.once("data",()=>process.stdout.write(JSON.stringify({id:999,value:true})+"\\n"));')
            with self.assertRaisesRegex(RuntimeError, 'response-mismatch'):
                host_rpc.invoke('node', entry, 'reference', [])
            self.assertFalse(host_rpc._workers)

    def test_worker_terminates_when_parent_dies(self):
        script = 'import host_rpc,sys,time; host_rpc.invoke("node",sys.argv[1],"reference",["docker.io/example/image@sha256:"+"a"*64]); print(next(iter(host_rpc._workers.values())).child.pid,flush=True); time.sleep(30)'
        parent = subprocess.Popen([sys.executable, '-c', script, str(ROOT / 'operations/dist/host/entry.js')],
            env=dict(os.environ, PYTHONPATH=str(ROOT / 'bootstrapper')), stdout=subprocess.PIPE, text=True)
        try:
            pid = int(parent.stdout.readline())
            parent.kill()
            parent.wait(timeout=5)
            for _ in range(100):
                stat = Path('/proc') / str(pid) / 'stat'
                if not stat.exists() or stat.read_text().split()[2] == 'Z': break
                time.sleep(.01)
            else: self.fail('worker survived parent death')
        finally:
            if parent.poll() is None: parent.kill(); parent.wait()
            parent.stdout.close()


if __name__ == '__main__': unittest.main()
