#!/usr/bin/env python3
"""Real committed Git snapshots and a fake Docker boundary; no daemon required."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
MOCK = r'''import json,os,pathlib,shutil,subprocess,sys
root=pathlib.Path(os.environ['DOC_FIXTURE']); args=sys.argv[1:]
configuration=None
if args[:1]==['--config']:
 configuration=pathlib.Path(args[1]);args=args[2:]
with (root/'calls.jsonl').open('a') as out:out.write(json.dumps(args)+'\n')
state=root/'state.json'
def load():return json.loads(state.read_text()) if state.exists() else {}
if args[:2]==['container','ls']:
 if os.environ.get('MOCK_OFFLINE'):sys.exit(1)
 if load().get('exists'):print(load()['name'])
elif args[:1]==['inspect']:
 value=load(); print('a'*64+' '+('foreign-owner' if os.environ.get('MOCK_FOREIGN') else value['owner']))
elif args[:1]==['rm']:
 if os.environ.get('MOCK_REMOVE_FAIL'):sys.exit(1)
 state.unlink(missing_ok=True)
elif args[:1]==['pull']:pass
elif args[:1]==['create']:
 assert configuration is not None and not list(configuration.iterdir()),'implicit client configuration leaked'
 shutil.rmtree(root/'received',ignore_errors=True)
 value={'exists':True,'name':args[args.index('--name')+1],'owner':args[args.index('--label')+1].split('=',1)[1],'create':args}
 state.write_text(json.dumps(value));print('a'*64)
elif args[:1]==['cp']:
 if args[1].startswith('system-documentation-'):
  for file in (root/'received/test-results/documentation').iterdir():shutil.copy2(file,pathlib.Path(args[2])/file.name)
 else:
  shutil.copytree(args[1],root/'received',dirs_exist_ok=True)
elif args[:1]==['start']:
 value=load(); selected={}
 for index,arg in enumerate(value['create']):
  if arg=='--env':key,data=value['create'][index+1].split('=',1);selected[key]=data
 (root/'child-environment.json').write_text(json.dumps(selected))
 program="const fs=require('fs');const out='test-results/documentation';fs.mkdirSync(out,{recursive:true});try{const r=require('./checker').check();fs.writeFileSync(out+'/report.json',JSON.stringify({status:'passed',...r}));}catch(e){fs.writeFileSync(out+'/report.json',JSON.stringify({status:'failed',reason:e.message}));process.exitCode=1;}"
 result=subprocess.run([os.environ['FIXTURE_NODE'],'-e',program],cwd=root/'received',env=dict(PATH=os.environ['PATH'],GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',**selected))
 value['status']=int(os.environ.get('MOCK_CHILD_STATUS',result.returncode));state.write_text(json.dumps(value))
elif args[:1]==['wait']:print(load().get('status',0))
elif args[:1]==['logs']:pass
else:raise RuntimeError('unexpected Docker boundary '+repr(args))
'''


class DocumentationChild(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='documentation-native-child-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'tests').mkdir()
        (self.root / 'gitlab').mkdir()
        (self.root / 'bin').mkdir()
        shutil.copy2(ROOT / 'tests/ci-documentation.sh', self.root / 'tests/ci-documentation.sh')
        shutil.copy2(ROOT / 'gitlab/check-documentation.js', self.root / 'gitlab/check-documentation.js')
        mock = self.root / 'bin/docker'
        mock.write_text('#!' + sys.executable + '\n' + MOCK)
        mock.chmod(0o755)
        self.git('init', '-q', '-b', 'master')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.root / 'historical-only.txt').write_text('unrelated-old-source-marker\n')
        self.commit('Historical source')
        self.old_blob = self.git('rev-parse', 'HEAD:historical-only.txt')
        self.git('rm', '-q', 'historical-only.txt')
        (self.root / 'README.md').write_text('# Public guide\n')
        self.base = self.commit('Baseline')
        (self.root / 'README.md').write_text('# Public guide\n\nInstructions.\n')
        self.head = self.commit('Documentation')
        self.git('remote', 'add', 'origin', 'https://fixture-private-marker@example.invalid/repository')
        self.git('config', 'http.extraHeader', 'fixture-private-header')
        self.node = shutil.which('node')
        self.assertIsNotNone(self.node, 'Run with the repository test Node runtime on PATH.')
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'],
            DOC_FIXTURE=str(self.root), FIXTURE_NODE=self.node,
            CI_PROJECT_ID='21', CI_JOB_ID='90001', CI_COMMIT_SHA=self.head,
            CI_PIPELINE_SOURCE='merge_request_event', CI_MERGE_REQUEST_DIFF_BASE_SHA=self.base,
            CI_COMMIT_BEFORE_SHA='', CI_JOB_TOKEN='fixture-sensitive-env',
            HTTP_PROXY='http://fixture-sensitive-proxy')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.PIPE, text=True).strip()

    def commit(self, message):
        self.git('add', '-A')
        self.git('commit', '-qm', message)
        return self.git('rev-parse', 'HEAD')

    def launch(self, extra=None, arguments=()):
        return subprocess.run(['sh', 'tests/ci-documentation.sh', *arguments], cwd=self.root,
            env=dict(self.env, **(extra or {})), capture_output=True, text=True, timeout=20)

    def calls(self):
        file = self.root / 'calls.jsonl'
        return [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []

    def test_real_diff_uses_sanitized_objects_without_private_files_or_environment(self):
        (self.root / 'README.md').write_text('dirty private worktree content\n')
        (self.root / 'untracked-private.txt').write_text('fixture-untracked-marker')
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        received = self.root / 'received'
        self.assertFalse((received / 'README.md').exists())
        self.assertFalse((received / 'untracked-private.txt').exists())
        config = (received / '.git/config').read_text()
        self.assertNotIn('fixture-private', config)
        self.assertNotIn('remote', config)
        self.assertFalse((received / '.git/hooks').exists())
        self.assertFalse((received / '.git/objects/info/alternates').exists())
        old = subprocess.run(['git', '-C', str(received), 'cat-file', '-e', self.old_blob], capture_output=True)
        self.assertNotEqual(old.returncode, 0, 'unrelated historical blobs must not enter the child')
        report = json.loads((self.root / 'test-results/documentation/report.json').read_text())
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['revision'], self.head)
        create = next(args for args in self.calls() if args[0] == 'create')
        for key, value in [('--network', 'none'), ('--user', '1000:1000'), ('--memory', '256m'),
                           ('--cpus', '1'), ('--pids-limit', '64'), ('--cap-drop', 'ALL'),
                           ('--security-opt', 'no-new-privileges')]:
            self.assertEqual(create[create.index(key) + 1], value)
        self.assertIn('--init', create)
        self.assertFalse(any(value in create for value in ('--privileged', '--volume', '-v', '--mount')))
        selected = json.loads((self.root / 'child-environment.json').read_text())
        self.assertEqual(set(selected), {'CI_PIPELINE_SOURCE', 'CI_COMMIT_SHA', 'CI_MERGE_REQUEST_DIFF_BASE_SHA',
                                        'CI_COMMIT_BEFORE_SHA', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'})
        self.assertNotIn('fixture-sensitive', json.dumps(selected))
        self.assertTrue(any(args[0] == 'rm' and args[-1] == 'a' * 64 for args in self.calls()))

    def test_first_push_and_manual_parent_comparison_remain_supported(self):
        for extra in ({'CI_PIPELINE_SOURCE': 'push', 'CI_COMMIT_BEFORE_SHA': '0' * 40},
                      {'CI_PIPELINE_SOURCE': 'web'}):
            with self.subTest(source=extra['CI_PIPELINE_SOURCE']):
                self.assertEqual(self.launch(extra).returncode, 0)

    def test_actual_whitespace_failure_is_propagated_and_artifact_preserved(self):
        (self.root / 'README.md').write_text('# Broken trailing whitespace \n')
        head = self.commit('Broken documentation')
        result = self.launch({'CI_COMMIT_SHA': head})
        self.assertNotEqual(result.returncode, 0)
        report = json.loads((self.root / 'test-results/documentation/report.json').read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertIn('diff --check failed', report['reason'])
        self.assertTrue(any(args[0] == 'rm' for args in self.calls()))

    def test_cleanup_refuses_foreign_resource_and_preserves_primary_failure(self):
        result = self.launch({'MOCK_FOREIGN': '1', 'MOCK_CHILD_STATUS': '7'})
        self.assertEqual(result.returncode, 7)
        self.assertFalse(any(args[0] == 'rm' for args in self.calls()))
        report = json.loads((self.root / 'test-results/documentation/cleanup-on-exit.json').read_text())
        self.assertEqual(report['status'], 'failed')

    def test_remove_failure_and_daemon_unavailability_are_not_success(self):
        self.assertEqual(self.launch({'MOCK_REMOVE_FAIL': '1'}).returncode, 1)
        self.assertEqual(self.launch({'MOCK_OFFLINE': '1'}, ('cleanup',)).returncode, 1)

    def test_cleanup_is_idempotent_when_owned_child_is_absent(self):
        self.assertEqual(self.launch(arguments=('cleanup',)).returncode, 0)
        self.assertEqual(self.calls(), [['container', 'ls', '--all', '--filter',
            'name=^/system-documentation-21-90001$', '--format', '{{.Names}}']])

    def test_invalid_source_and_identifiers_refuse_before_child_creation(self):
        for extra in ({'CI_COMMIT_SHA': 'b' * 40}, {'CI_MERGE_REQUEST_DIFF_BASE_SHA': ''},
                      {'CI_PROJECT_ID': '21:22'}, {'CI_JOB_ID': '../foreign'}):
            with self.subTest(extra=extra):
                self.assertNotEqual(self.launch(extra).returncode, 0)
        self.assertFalse(any(args[0] in ('create', 'pull') for args in self.calls()))


if __name__ == '__main__':
    unittest.main()
