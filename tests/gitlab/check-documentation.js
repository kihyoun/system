'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const {check} = require('../../gitlab/check-documentation');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documentation-check-'));
const git = (...args) => execFileSync('git', ['-C', root, ...args],
  {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
const write = (name, value) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
  fs.writeFileSync(path.join(root, name), value);
};
const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
const environment = (base, head, extra = {}) => ({CI_PIPELINE_SOURCE: 'merge_request_event',
  CI_MERGE_REQUEST_DIFF_BASE_SHA: base, CI_COMMIT_SHA: head, ...extra});
try {
  git('init', '-b', 'master'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('README.md', '# Guide\n'); write('runtime.sh', '#!/bin/sh\necho ready\n');
  const initial = commit('Initial source');
  const first = check(environment('', initial, {CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BEFORE_SHA: '0'.repeat(40)}), root);
  assert.deepEqual(first.markdownFiles, ['README.md'], 'first default-branch push checks the complete initial tree');

  write('README.md', '# Guide\n\nÜberblick and instructions.\n'); const clean = commit('Documentation');
  assert.deepEqual(check(environment(initial, clean), root).markdownFiles, ['README.md']);
  assert.equal(check(environment('', clean, {CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BEFORE_SHA: initial}), root).base, initial);
  assert.equal(check(environment('', clean, {CI_PIPELINE_SOURCE: 'web'}), root).base, initial);
  assert.throws(() => check(environment('', clean), root), /diff base/);
  assert.throws(() => check(environment('0'.repeat(40), clean), root), /diff base/);
  assert.throws(() => check(environment('a'.repeat(40), clean), root), /diff --check failed/);
  assert.throws(() => check(environment(initial, initial), root), /CI_COMMIT_SHA/);
  assert.throws(() => check(environment('', clean, {CI_PIPELINE_SOURCE: 'push'}), root), /push diff base/);

  write('README.md', 'uncommitted private working-copy data\n');
  assert.deepEqual(check(environment(initial, clean), root).markdownFiles, ['README.md'], 'only committed objects are read');
  git('restore', 'README.md');
  write('docs/broken.md', '# Broken \n'); const whitespace = commit('Bad whitespace');
  assert.throws(() => check(environment(clean, whitespace), root), /diff --check failed/);
  git('reset', '--hard', clean);
  write('docs/conflict.md', '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n'); const conflict = commit('Conflict marker');
  assert.throws(() => check(environment(clean, conflict), root), /diff --check failed/);
  git('reset', '--hard', clean);
  write('docs/invalid.md', Buffer.from([0xff, 10])); const invalid = commit('Invalid UTF-8');
  assert.throws(() => check(environment(clean, invalid), root), /UTF-8/);
  git('reset', '--hard', clean);
  write('docs/binary.md', Buffer.from([0, 10])); const binary = commit('Binary Markdown');
  assert.throws(() => check(environment(clean, binary), root), /binary data/);
  git('reset', '--hard', clean);
  fs.symlinkSync('/outside/never-read', path.join(root, 'unsafe.md')); const symlink = commit('Markdown link');
  assert.throws(() => check(environment(clean, symlink), root), /regular file/);
  git('reset', '--hard', clean);
  fs.mkdirSync(path.join(root, 'docs')); git('mv', 'runtime.sh', 'docs/runtime.md'); const renamed = commit('Code renamed into docs');
  assert.deepEqual(check(environment(clean, renamed), root).markdownFiles, ['docs/runtime.md']);
  git('rm', 'README.md'); const deleted = commit('Delete guide');
  assert.deepEqual(check(environment(renamed, deleted), root).markdownFiles, [], 'deleted documents are not opened');
  write('docs/new\nname.md', '# A filename with a newline\n'); const newline = commit('Newline filename');
  assert.deepEqual(check(environment(deleted, newline), root).markdownFiles, ['docs/new\nname.md']);
  const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../../gitlab/check-documentation.js')],
    {cwd: root, env: {...process.env, ...environment(deleted, newline)}, encoding: 'utf8'});
  const report = JSON.parse(fs.readFileSync(path.join(root, 'test-results/documentation/report.json'), 'utf8'));
  if (fs.existsSync('/var/run/docker.sock')) {
    assert.notEqual(cli.status, 0); assert.match(report.reason, /socket-free/);
  } else {
    assert.equal(cli.status, 0, cli.stderr); assert.equal(report.status, 'passed');
  }
  console.log('PASS: real committed MR/push/first-push/manual diffs, stale/missing bases, dirty exclusion, whitespace/conflicts, UTF-8, binary/symlink refusal, renames/deletions, NUL-separated paths and CLI/socket guard');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
