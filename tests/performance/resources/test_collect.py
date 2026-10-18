"""Offline fixtures: no Docker, WSL, services or workloads are invoked."""
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import collect


class FixtureCollector(collect.Collector):
    def linux(self):
        return {'memoryUsedFromAvailableBytes': 100}

    def cgroup(self, pid, container_id):
        return None

    def run(self, args, metric):
        identity = 'a' * 64
        if metric == 'docker-info':
            return json.dumps({'serverVersion': '29.8.0', 'architecture': 'x86_64', 'logicalCpus': 4,
                               'memoryTotalBytes': 1024, 'cgroupVersion': '2', 'private': 'SECRET'})
        if metric == 'docker-inventory':
            return '\n'.join([identity, 'b' * 64])
        if metric == 'docker-stats':
            return json.dumps({'ID': identity, 'Name': 'PRIVATE', 'MemUsage': '2MiB / 1GiB',
                               'CPUPerc': '20.2%', 'NetIO': '1kB / 2kB', 'BlockIO': '0B / 0B', 'PIDs': '4'})
        if metric == 'container-inspect':
            return json.dumps({'name': '/system_gitlab-runner_SECRET', 'pid': 12,
                               'imageConfigDigest': 'sha256:' + 'c' * 64, 'running': True, 'oomKilled': False,
                               'memoryLimitBytes': 0, 'memorySwapLimitBytes': -1, 'nanoCpuLimit': 0,
                               'restartCount': 0, 'exitCode': 0, 'env': ['TOKEN=SECRET']})
        if metric == 'runner-concurrency':
            return 'concurrent = 2\nlimit = 1\nrequest_concurrency = 3\ntoken = "SECRET"\n'
        raise AssertionError(metric)


class Tests(unittest.TestCase):
    def test_units_and_invalid_values(self):
        self.assertEqual(collect.quantity('1.5GiB'), 1610612736)
        self.assertEqual(collect.pair('1kB / 2KiB'), [1000, 2048])
        for value in ['NaN', 'Infinity', '-1', 'SECRET']:
            self.assertIsNone(collect.number(value))
            self.assertIsNone(collect.quantity(value))

    def test_sanitized_schema_inventory_bounds_and_timestamps(self):
        sample = FixtureCollector(maximum_containers=1).sample()
        text = json.dumps(sample)
        for private in ['SECRET', 'PRIVATE', 'TOKEN', 'a' * 64, 'system_gitlab']:
            self.assertNotIn(private, text)
        self.assertTrue(sample['inventoryTruncated'])
        self.assertLessEqual(sample['startedAt'], sample['completedAt'])
        row = sample['containers'][0]
        self.assertTrue(row['memorySwapUnlimited'])
        self.assertIsNone(row['memorySwapLimitBytes'])
        self.assertEqual(row['runnerConcurrency']['concurrent'], [2])
        self.assertEqual(row['dockerCli']['memoryUsageExcludingCacheBytesApprox'], 2097152)
        self.assertFalse(collect.summary([sample])['productionSizingReady'])

    def test_command_timeout_and_stderr_are_not_exposed(self):
        subject = collect.Collector()
        subject.deadline = collect.time.monotonic() + 10
        with patch('collect.subprocess.Popen', side_effect=OSError('SECRET TOKEN')):
            self.assertIsNone(subject.run(['secret-command'], 'fixture'))
        self.assertEqual(subject.unavailable, ['fixture:command-unavailable'])
        subject.deadline = 0
        self.assertIsNone(subject.run(['never-start'], 'expired'))
        self.assertIn('expired:sample-budget', subject.unavailable)

    def test_incomplete_role_memory_is_null_with_coverage(self):
        sample = FixtureCollector(maximum_containers=1).sample()
        sample['containers'].append({'role': 'runner-manager', 'dockerCli': {
            'memoryUsageExcludingCacheBytesApprox': None}})
        result = collect.summary([sample])
        self.assertIsNone(result['sampledRoleWorkingSetMaximumBytesApprox']['runner-manager'])
        self.assertEqual(result['roleMemoryCoverage']['runner-manager'], {
            'containerObservations': 2, 'measuredObservations': 1, 'incompleteSamples': 1})
        complete = FixtureCollector(maximum_containers=1).sample()
        self.assertIsNone(collect.summary([sample, complete])['sampledRoleWorkingSetMaximumBytesApprox']['runner-manager'])

    def test_transport_timeout_kills_descendants_and_redacts(self):
        with tempfile.TemporaryDirectory(prefix='resource-offline-') as folder:
            marker = Path(folder) / 'survived'
            descendant = 'import time,pathlib; time.sleep(1.5); pathlib.Path(' + repr(str(marker)) + ').touch()'
            parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",' + repr(descendant) + ']); time.sleep(5)'
            subject = collect.Collector()
            subject.deadline = time.monotonic() + 0.3
            started = time.monotonic()
            self.assertIsNone(subject.run([sys.executable, '-c', parent], 'fixture'))
            self.assertLess(time.monotonic() - started, 2)
            self.assertEqual(subject.unavailable, ['fixture:command-timeout'])
            time.sleep(1.6)
            self.assertFalse(marker.exists(), 'Timed-out transport descendant survived')

    def test_output_cap_applies_to_stdout_and_stderr(self):
        for stream in ['stdout', 'stderr', 'combined']:
            subject = collect.Collector()
            subject.deadline = time.monotonic() + 3
            if stream == 'combined':
                program = 'import sys,time; sys.stdout.buffer.write(b"x"*1100000); sys.stdout.flush(); sys.stderr.buffer.write(b"x"*1100000); sys.stderr.flush(); time.sleep(5)'
            else:
                program = 'import sys,time; sys.' + stream + '.buffer.write(b"x"*2100000); sys.' + stream + '.flush(); time.sleep(5)'
            self.assertIsNone(subject.run([sys.executable, '-c', program], 'fixture'))
            self.assertEqual(subject.unavailable, ['fixture:output-limit'])

    def test_success_retains_only_stdout(self):
        subject = collect.Collector()
        subject.deadline = time.monotonic() + 3
        self.assertEqual(subject.run([sys.executable, '-c',
            'import sys; print("metric"); print("SECRET",file=sys.stderr)'], 'fixture'), 'metric\n')
        self.assertEqual(subject.unavailable, [])

    def test_cancellation_cleans_up_before_propagating(self):
        subject = collect.Collector()
        subject.deadline = time.monotonic() + 3
        real_sleep = time.sleep
        interrupted = False

        def interrupt_once(seconds):
            nonlocal interrupted
            if not interrupted:
                interrupted = True
                raise KeyboardInterrupt()
            real_sleep(seconds)

        with patch('collect.time.sleep', side_effect=interrupt_once), patch.object(subject, 'stop', wraps=subject.stop) as stop:
            with self.assertRaises(KeyboardInterrupt):
                subject.run([sys.executable, '-c', 'import time; time.sleep(5)'], 'fixture')
            self.assertEqual(stop.call_count, 1)
            self.assertIsNotNone(stop.call_args.args[0].poll())

    def test_remote_pid_must_not_map_to_unrelated_cgroup(self):
        with patch('collect.Path.read_text', return_value='0::/unrelated\n'):
            self.assertIsNone(collect.Collector().cgroup(1, 'a' * 64))

    def test_runner_roles_and_settings(self):
        self.assertEqual(collect.role('runner-TOKEN-project-4-concurrent-0'), 'ci-job')
        self.assertEqual(collect.runner_settings('token="SECRET"\nconcurrent=4\nlimit=-1'),
                         {'concurrent': [4], 'limit': [], 'request_concurrency': []})


if __name__ == '__main__':
    unittest.main()
