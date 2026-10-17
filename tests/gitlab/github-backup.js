const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFile } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'system-github-backup-'));
const helper = path.resolve(__dirname, '../../gitlab/github-backup.sh').replace(/\\/g, '/');
const shell = process.env.GITHUB_BACKUP_TEST_SHELL || 'sh';
const posix = value => value.replace(/\\/g, '/');
const quote = value => `'${posix(value).replace(/'/g, `'"'"'`)}'`;
const baseEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
const shellPath = process.platform === 'win32'
  ? [path.dirname(shell), ...process.env.PATH.split(';')]
    .map(value => posix(value).replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`)).join(':')
  : process.env.PATH;
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete baseEnv[key];
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env: baseEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
let counter = 0;
function fixture() {
  const dir = path.join(tmp, String(++counter));
  fs.mkdirSync(dir);
  const source = path.join(dir, 'source.git');
  const backup = path.join(dir, 'backup.git');
  const work = path.join(dir, 'work');
  git(dir, 'init', '--bare', source);
  git(dir, 'init', '--bare', backup);
  git(dir, 'init', '-b', 'main', work);
  fs.writeFileSync(path.join(work, 'source'), 'base');
  git(work, 'add', 'source');
  git(work, 'commit', '-qm', 'base');
  const base = git(work, 'rev-parse', 'HEAD');
  git(work, 'remote', 'add', 'origin', posix(source));
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(work, 'push', '-q', posix(backup), 'HEAD:master');
  fs.writeFileSync(path.join(work, 'source'), 'merged change');
  git(work, 'commit', '-qam', 'merged change');
  const sha = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  const env = { ...baseEnv, GITHUB_BACKUP_ENABLED: 'true', GITLAB_CI: 'true',
    CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main', CI_DEFAULT_BRANCH: 'main',
    CI_COMMIT_TAG: '', CI_COMMIT_REF_PROTECTED: 'true', CI_PROJECT_PATH: 'primary/system',
    CI_COMMIT_SHA: sha, GITHUB_BACKUP_SOURCE_PROJECT: 'primary/system',
    GITHUB_BACKUP_BRANCH: 'master', GITHUB_BACKUP_REMOTE: posix(backup),
    GITHUB_BACKUP_OFFLINE_FIXTURE: '1' };
  const tip = () => git(dir, '--git-dir', backup, 'rev-parse', 'refs/heads/master');
  function run(extra = {}, cwd = work) {
    const result = spawnSync(shell, [helper], { cwd, env: { ...env, PATH: shellPath, ...extra }, encoding: 'utf8' });
    if (result.error) throw result.error;
    assert(!`${result.stdout}${result.stderr}`.includes('FIXTURE_SECRET_DO_NOT_LOG'));
    return result;
  }
  return { dir, source, backup, work, base, sha, env, tip, run };
}
function pass(result) { assert.equal(result.status, 0, result.stderr); }
function fail(result, text) { assert.notEqual(result.status, 0); assert.match(result.stderr, text); }
function wrapper(f, mode, raceSha = '') {
  const bin = path.join(f.dir, 'bin');
  fs.mkdirSync(bin);
  const gitPath = process.platform === 'win32'
    ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0]
    : spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
case " $* " in
  *" push "*)
    if [ ! -f ${quote(path.join(f.dir, 'attempted'))} ]; then
      : > ${quote(path.join(f.dir, 'attempted'))}
      case ${quote(mode)} in
        fail-once) echo FIXTURE_SECRET_DO_NOT_LOG >&2; exit 1;;
        lost-response) ${quote(gitPath)} "$@"; echo FIXTURE_SECRET_DO_NOT_LOG >&2; exit 1;;
        race) ${quote(gitPath)} --git-dir=${quote(f.backup)} update-ref refs/heads/master ${quote(raceSha)};;
      esac
    fi
    [ ${quote(mode)} != always-fail ] || { echo FIXTURE_SECRET_DO_NOT_LOG >&2; exit 1; }
    ;;
esac
exec ${quote(gitPath)} "$@"
`, { mode: 0o755 });
  // A POSIX PATH is needed inside Git for Windows' shell as well.
  const prefix = posix(bin).replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
  return { PATH: `${prefix}:${shellPath}` };
}

async function main() {
  let f = fixture();
  pass(f.run());
  assert.equal(f.tip(), f.sha, 'backup receives the exact merged commit');
  pass(f.run());
  assert.equal(git(f.work, 'remote', 'get-url', 'origin'), posix(f.source));
  assert.equal(git(f.work, 'show-ref', '--verify', '--quiet', 'refs/heads/main'), '');
  assert(!fs.existsSync(path.join(f.work, '.git/system-github-backup.lock')));
  pass(f.run({ CI_COMMIT_SHA: f.base }, (() => {
    git(f.work, 'checkout', '-q', '--detach', f.base);
    return f.work;
  })()));
  assert.equal(f.tip(), f.sha, 'older queued commit cannot rewind backup');

  for (const extra of [{ GITHUB_BACKUP_ENABLED: '' }, { CI_PIPELINE_SOURCE: 'merge_request_event' },
    { CI_PIPELINE_SOURCE: 'api' }, { CI_COMMIT_BRANCH: 'feature' }, { CI_COMMIT_TAG: 'v1' }]) {
    f = fixture(); pass(f.run(extra)); assert.equal(f.tip(), f.base);
  }
  for (const [extra, message] of [
    [{ CI_COMMIT_REF_PROTECTED: 'false' }, /protected/],
    [{ CI_PROJECT_PATH: 'other/project' }, /mapping mismatch/],
    [{ CI_COMMIT_SHA: 'bad' }, /full pinned/],
    [{ CI_COMMIT_SHA: 'a'.repeat(40) }, /checkout differs/],
    [{ GITHUB_BACKUP_BRANCH: 'absent' }, /existing backup branch/],
    [{ GITHUB_BACKUP_REMOTE: 'https://FIXTURE_SECRET_DO_NOT_LOG@example.invalid/x' }, /absolute offline/],
    [{ GITHUB_BACKUP_OFFLINE_FIXTURE: '' }, /explicit GitHub SSH/],
  ]) {
    f = fixture(); fail(f.run(extra), message); assert.equal(f.tip(), f.base);
  }
  f = fixture();
  git(f.dir, '--git-dir', f.source, 'update-ref', 'refs/heads/main', f.base);
  fail(f.run(), /no longer in the source/); assert.equal(f.tip(), f.base);

  f = fixture();
  git(f.work, 'checkout', '-q', '--detach', f.base);
  fs.writeFileSync(path.join(f.work, 'backup-only'), 'independent GitHub change');
  git(f.work, 'add', '.'); git(f.work, 'commit', '-qm', 'divergent backup');
  const divergent = git(f.work, 'rev-parse', 'HEAD');
  git(f.work, 'push', '-q', posix(f.backup), 'HEAD:master');
  git(f.work, 'checkout', '-q', '--detach', f.sha);
  fail(f.run(), /diverged/); assert.equal(f.tip(), divergent);

  f = fixture();
  const lock = path.join(f.work, '.git/system-github-backup.lock');
  fs.mkdirSync(lock); fail(f.run(), /lock held/); fs.rmdirSync(lock);
  pass(f.run());
  f = fixture();
  const shallow = path.join(f.dir, 'shallow');
  const fileUrl = `file://${process.platform === 'win32' ? '/' : ''}${posix(f.source)}`;
  git(f.dir, 'clone', '-q', '--depth', '1', '-b', 'main', fileUrl, shallow);
  assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
  pass(f.run({}, shallow));
  assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(f.tip(), f.sha);
  for (const mode of ['fail-once', 'lost-response', 'always-fail']) {
    f = fixture(); const extra = wrapper(f, mode);
    const result = f.run(extra);
    if (mode === 'always-fail') {
      fail(result, /bounded retries/); assert.equal(f.tip(), f.base);
      pass(f.run());
    } else pass(result);
    assert.equal(f.tip(), f.sha);
  }
  f = fixture();
  fs.writeFileSync(path.join(f.work, 'source'), 'newer merged change');
  git(f.work, 'commit', '-qam', 'newer merged change');
  const newer = git(f.work, 'rev-parse', 'HEAD');
  git(f.work, 'push', '-q', 'origin', 'HEAD:main');
  git(f.work, 'push', '-q', posix(f.backup), 'HEAD:refs/heads/staged');
  git(f.work, 'checkout', '-q', '--detach', f.sha);
  pass(f.run(wrapper(f, 'race', newer)));
  assert.equal(f.tip(), newer, 'concurrent newer backup is never rewound');

  f = fixture();
  git(f.work, 'checkout', '-q', '--detach', f.base);
  fs.writeFileSync(path.join(f.work, 'backup-only'), 'racing independent change');
  git(f.work, 'add', '.'); git(f.work, 'commit', '-qm', 'racing divergent backup');
  const racingDivergence = git(f.work, 'rev-parse', 'HEAD');
  git(f.work, 'push', '-q', posix(f.backup), 'HEAD:refs/heads/staged');
  git(f.work, 'checkout', '-q', '--detach', f.sha);
  fail(f.run(wrapper(f, 'race', racingDivergence)), /diverged/);
  assert.equal(f.tip(), racingDivergence, 'racing divergence survives rejected push');

  f = fixture();
  const second = path.join(f.dir, 'second');
  git(f.dir, 'clone', '-q', '-b', 'main', posix(f.source), second);
  const runAsync = cwd => new Promise((resolve, reject) => execFile(shell, [helper],
    { cwd, env: { ...f.env, PATH: shellPath } },
    (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout)));
  await Promise.all([runAsync(f.work), runAsync(second)]);
  assert.equal(f.tip(), f.sha, 'independent checkouts converge safely');
  console.log('PASS: guarded FF-only backup, idempotency, queued commits, divergence, locks, transport retry/redaction, competing checkouts');
}
main().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
