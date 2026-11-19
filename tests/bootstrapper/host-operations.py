#!/usr/bin/env python3
"""Offline host facts, compatibility decisions and exact Docker logging inspection."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bootstrapper' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preflight = load('container-preflight')
logging = load('log-policy')


class Compatibility(unittest.TestCase):
    def facts(self, release='7.0.0-30-generic', signature='Ubuntu 7.0.0-30.30-generic 7.0.12', flags='avx sse2'):
        return preflight.host_facts(release, signature, 'flags : ' + flags, 'x86_64', True)

    def codes(self, facts, mongo='8.0.37'):
        return [item['code'] for item in preflight.assess(facts, preflight.version(mongo))]

    def test_ubuntu_uses_upstream_and_separates_cpu(self):
        facts = self.facts()
        self.assertEqual(facts['upstreamKernel'], '7.0.12')
        self.assertEqual(self.codes(facts), ['kernel-mongodb-incompatible'])
        self.assertEqual(self.codes(self.facts(flags='sse2')), ['cpu-avx-missing', 'kernel-mongodb-incompatible'])
        self.assertEqual(self.codes(facts, '7.0.48'), [])
        # Old images may pass --version and still crash later; reject by policy.
        self.assertEqual(self.codes(facts, '8.0.20'), ['kernel-mongodb-incompatible'])

    def test_all_cpus_must_expose_avx(self):
        facts = preflight.host_facts('6.8.0', '', 'flags : avx sse2\nflags : sse2\n', 'x86_64', False)
        self.assertEqual(self.codes(facts), ['cpu-avx-missing'])

    def test_boundary_and_reviewed_patches(self):
        for kernel, expected in [('6.18.99', []), ('6.19.0', ['kernel-mongodb-incompatible']),
                                 ('7.0.13', ['kernel-mongodb-incompatible']), ('7.0.14', []), ('7.1.0', [])]:
            facts = preflight.host_facts(kernel, '', 'flags : avx', 'x86_64', False)
            self.assertEqual(self.codes(facts), expected)
        fixed = self.facts(signature='Ubuntu 7.0.0-30.30-generic 7.0.14')
        self.assertEqual(self.codes(fixed, '8.0.36'), ['mongodb-patch-required'])
        self.assertEqual(self.codes(fixed, '8.3.16'), [])
        self.assertEqual(self.codes(fixed, '9.0.4'), [])
        self.assertEqual(self.codes(fixed, '8.1.0'), ['mongodb-version-unreviewed'])

    def test_unknown_signature_is_not_guessed(self):
        for signature in ['', 'Ubuntu malformed', 'Ubuntu 6.8.0-20.20-generic 7.0.14', 'Ubuntu 7.0.0-29.29-generic 7.0.14']:
            self.assertEqual(self.codes(self.facts(signature=signature)), ['kernel-version-unknown'])
        self.assertEqual(self.codes({**self.facts(), 'architecture': 'aarch64'}),
                         ['unsupported-architecture', 'kernel-mongodb-incompatible'])
        with self.assertRaises(ValueError):
            preflight.version('latest')

    def probe(self, code, output):
        result = subprocess.CompletedProcess([], code, output.encode())
        def execute(args, **_):
            if 'run' in args:
                return result
            if 'inspect' in args:
                return subprocess.CompletedProcess([], 0, args[-1].encode())
            return subprocess.CompletedProcess([], 0)
        with patch.object(preflight.subprocess, 'run', side_effect=execute) as run:
            report = preflight.probe('example/mongo@sha256:' + 'a' * 64, 10)
        invocation = run.call_args_list[0].args[0]
        self.assertIn('--read-only', invocation)
        self.assertIn('--pull', invocation)
        self.assertEqual(invocation[invocation.index('--pull') + 1], 'never')
        self.assertEqual(invocation[-2:], ['example/mongo@sha256:' + 'a' * 64, '--version'])
        self.assertNotIn('--volume', invocation)
        self.assertNotIn('--mount', invocation)
        self.assertEqual(run.call_args_list[-1].args[0][-3:-1], ['rm', '-f'])
        return report

    def test_cli_cross_checks_image_identity_and_skips_unsafe_probe(self):
        for facts, probe, code, expected_calls in [
            (preflight.host_facts('6.8.0', '', 'flags : avx', 'x86_64', False),
             {'code': 'image-probe-passed', 'mongodbVersion': '8.0.36'}, 'image-version-mismatch', 1),
            (self.facts(), {'code': 'image-probe-passed'}, 'kernel-mongodb-incompatible', 0),
        ]:
            output = io.StringIO()
            with patch('sys.argv', ['container-preflight.py', '--mongodb-version', '8.0.37', '--image', 'image@sha256:' + 'a' * 64]), \
                 patch.object(preflight, 'host_facts', return_value=facts), \
                 patch.object(preflight, 'probe', return_value=probe) as check, \
                 patch.object(preflight.platform, 'system', return_value='Linux'), \
                 patch.dict(preflight.os.environ, {'DOCKER_CONTEXT': 'default', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(preflight.main(), 1)
            self.assertEqual(check.call_count, expected_calls)
            self.assertIn(code, [item['code'] for item in json.loads(output.getvalue())['findings']])

    def test_image_failures_have_distinct_diagnoses(self):
        self.assertEqual(self.probe(0, 'db version v8.0.37')['mongodbVersion'], '8.0.37')
        self.assertEqual(self.probe(1, '12257600 incompatible kernel')['code'], 'image-kernel-rejected')
        self.assertEqual(self.probe(132, 'Illegal instruction')['code'], 'image-illegal-instruction')
        self.assertEqual(self.probe(127, 'mongod executable not found')['code'], 'image-execution-failed')
        self.assertEqual(self.probe(0, 'unexpected wrapper output')['code'], 'image-version-unrecognized')
        with patch.object(preflight.subprocess, 'run', side_effect=[subprocess.TimeoutExpired([], 10), subprocess.CompletedProcess([], 1, b'')]):
            self.assertEqual(preflight.probe('example/mongo@sha256:' + 'a' * 64, 10)['code'], 'image-probe-timeout')
        with self.assertRaises(ValueError):
            preflight.probe('mongo:latest', 10)


class Logging(unittest.TestCase):
    def test_validated_size_and_file_count(self):
        self.assertEqual(logging.policy(), {'Type': 'json-file', 'Config': {'max-size': '10m', 'max-file': '3'}})
        self.assertEqual(logging.policy('64K', '2')['Config'], {'max-size': '64k', 'max-file': '2'})
        for size, count in [('0m', '3'), ('-1', '3'), ('10m', '0'), ('10m', '101'), ('10m', '1.5')]:
            with self.assertRaises(ValueError):
                logging.policy(size, count)

    def test_inspector_reads_exact_container_without_mutation(self):
        for actual, match in [(logging.policy(), True), ({'Type': 'json-file', 'Config': {}}, False),
                              ({'Type': 'journald', 'Config': {}}, False)]:
            with patch.object(logging.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(actual).encode())) as run:
                self.assertEqual(logging.verify('owned-app', logging.policy())['matches'], match)
            self.assertEqual(run.call_args.args[0][-1], 'owned-app')
            self.assertEqual(run.call_args.args[0][3:5], ['container', 'inspect'])


if __name__ == '__main__':
    unittest.main()
