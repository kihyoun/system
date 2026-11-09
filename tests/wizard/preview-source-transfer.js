'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const child = require('child_process');
const originalExec = child.execFile, originalLookup = dns.lookup;
const sha = 'a'.repeat(40), historicalSha = 'b'.repeat(40), destination = 'https://gitlab.example.test/team/fork.git';
const origin = 'https://source.example.test/fork.git', master = 'refs/heads/master';
const producers = '# approved native CI fixture\n';
const input = {origin, destination, token: 'fixture-scoped-token', approvedFiles: [
  {path: '.gitlab/primary.yml', sha256: crypto.createHash('sha256').update(producers).digest('hex')}]};
const refs = [...Array.from({length: 7}, (_, n) => [historicalSha, 'refs/heads/codex/history-' + n]),
  [sha, master], [historicalSha, 'refs/tags/v0.1.0']];
let actual, calls, pushes, failure, sourceRefs, advertised, symbolic, native, afterPush;
function reset() {
  actual = new Map(); calls = []; pushes = []; failure = undefined; afterPush = undefined;
  sourceRefs = refs; advertised = 'ref: ' + master + '\tHEAD\n' + sha + '\tHEAD'; symbolic = master;
}
reset();
dns.lookup = async () => [{address: '1.1.1.1'}];
child.execFile = (command, args, options, callback) => {
  assert.equal(command, 'git');
  if (native) {
    const mapped = args.map(value => value === origin ? native.source : value === destination ? native.destination : value);
    return originalExec(command, ['-c', 'protocol.file.allow=always', ...mapped], options, (error, stdout, stderr) => {
      if (!error && args.includes('clone')) fixtureGit(args.at(-1), 'config', 'push.followTags', 'true');
      callback(error, stdout, stderr);
    });
  }
  calls.push({args, options});
  let output = '';
  const push = args.includes('push'), ordinal = pushes.length + 1;
  if (failure && args.includes(failure.command) && (!failure.ordinal || failure.ordinal === ordinal) && !failure.after) {
    callback(failure.error, ''); return;
  }
  if (args.includes('clone')) {
    assert(args.includes('http.curloptResolve=source.example.test:443:1.1.1.1'));
    assert(args.includes('protocol.allow=never')); assert(args.includes('http.proxy='));
    assert(!options.env.PREVIEW_GIT_TOKEN); assert(!options.env.GIT_ASKPASS);
    fs.mkdirSync(args.at(-1));
  } else if (args.includes('show')) {
    assert(!options.env.PREVIEW_GIT_TOKEN); output = producers;
  } else if (args.includes('for-each-ref')) output = sourceRefs.map(row => row.join(' ')).join('\n');
  else if (args.includes('symbolic-ref')) output = symbolic;
  else if (args.includes('ls-remote') && args.includes(destination)) output = [...actual].map(([ref, id]) => id + '\t' + ref).join('\n');
  else if (args.includes('ls-remote')) {
    assert(args.includes('http.curloptResolve=source.example.test:443:1.1.1.1'));
    assert(!options.env.PREVIEW_GIT_TOKEN); assert(!options.env.GIT_ASKPASS); output = advertised;
  } else if (push) {
    const selected = args.filter(value => /^refs\/(?:heads|tags)\/.+:refs\//.test(value)).map(value => value.split(':')[0]);
    pushes.push({args, selected});
    assert(args.includes('--atomic')); assert(args.includes('--no-follow-tags')); assert(!args.includes('--force'));
    for (const name of selected) assert(args.includes('--force-with-lease=' + name + ':'));
    assert.equal(args.filter(value => value.startsWith('--force-with-lease=')).length, selected.length);
    assert.equal(options.env.PREVIEW_GIT_TOKEN, input.token);
    assert(!args.join(' ').includes(input.token));
    assert(fs.existsSync(options.env.GIT_ASKPASS));
    assert.equal(fs.statSync(options.env.GIT_ASKPASS).mode & 0o777, 0o700);
    assert(calls.some(row => row.args.includes('show')), 'Producer verification must precede either push');
    for (const name of selected) {
      assert(!actual.has(name), 'An import must never overwrite a ref');
      actual.set(name, sourceRefs.find(row => row[1] === name)[0]);
    }
    if (afterPush) afterPush(ordinal);
  } else throw Error('Unexpected Git action');
  if (failure && push && failure.command === 'push' && failure.ordinal === ordinal && failure.after) callback(failure.error, '');
  else callback(null, output);
};
const {transfer} = require('../../project-bootstrap/preview-setup/source');
const cleaned = () => {
  for (const row of calls.filter(row => row.options.env.GIT_ASKPASS))
    assert(!fs.existsSync(row.options.env.GIT_ASKPASS), 'Temporary credential helper survived transfer');
};
function fixtureGit(cwd, ...args) {
  return child.execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
(async () => {
  assert.equal((await transfer(input)).imported, true);
  assert.equal(pushes.length, 2);
  assert.deepEqual(pushes[0].selected, [master], 'Historical ref ordering must not displace default-branch CI');
  assert(!pushes[0].args.some(value => /ci\.skip|push-option/.test(value)), 'Candidate CI must use an ordinary source push');
  assert(pushes[1].args.includes('--push-option=ci.skip'));
  assert.equal(pushes[1].selected.length, refs.length - 1);
  assert(!pushes[1].selected.includes(master));
  cleaned();
  assert.equal((await transfer(input)).unchanged, true); assert.equal(pushes.length, 2, 'Complete old imports are not repushed or assigned invented pipelines');
  cleaned();

  reset(); sourceRefs = [[sha, master]];
  assert.equal((await transfer(input)).imported, true); assert.equal(pushes.length, 1);
  assert(!pushes[0].args.includes('--push-option=ci.skip')); cleaned();

  reset(); actual.set(master, sha);
  assert.equal((await transfer(input)).imported, true);
  assert.equal(pushes.length, 1); assert(pushes[0].args.includes('--push-option=ci.skip'));
  assert(!pushes[0].selected.includes(master), 'Default-only resumption must preserve its original native pipeline'); cleaned();

  for (const remote of [new Map([[master, historicalSha]]), new Map([[master, sha], [refs[0][1], historicalSha]]),
    new Map([[refs[0][1], historicalSha]]), new Map([...refs.map(([id, name]) => [name, id]), ['refs/heads/operator-edits', historicalSha]])]) {
    reset(); actual = remote;
    await assert.rejects(transfer(input), /changed or additional refs/); assert.equal(pushes.length, 0); cleaned();
  }
  reset(); afterPush = ordinal => { if (ordinal === 1) actual.set('refs/heads/operator-edits', historicalSha); };
  await assert.rejects(transfer(input), /changed or additional refs/);
  assert.equal(pushes.length, 1, 'Unknown refs appearing after the default push must block historical import'); cleaned();
  reset(); afterPush = ordinal => { if (ordinal === 2) actual.set(master, historicalSha); };
  await assert.rejects(transfer(input), /changed or additional refs/);
  assert.equal(actual.get(master), historicalSha, 'Historical transfer must not overwrite a concurrent default-branch edit'); cleaned();
  reset(); failure = {command: 'push', ordinal: 2, error: Object.assign(Error('private failure'), {code: 'ENOENT'})};
  await assert.rejects(transfer(input), error => !error.uncertain && !error.message.includes('private'));
  assert.deepEqual([...actual], [[master, sha]], 'A definite historical-transfer failure preserves the confirmed default-only state');
  cleaned(); failure = undefined;
  await transfer(input); assert.equal(pushes.length, 2); assert(pushes[1].args.includes('--push-option=ci.skip')); cleaned();

  for (const [ordinal, code, after, uncertain] of [[1, 'ETIMEDOUT', false, true], [1, 'ECONNRESET', true, true],
    [2, 'ETIMEDOUT', false, true], [2, 'ECONNRESET', true, true], [1, 'ENOENT', false, false], [2, 'EACCES', false, false]]) {
    reset(); failure = {command: 'push', ordinal, after, error: Object.assign(Error('private transport stderr'), {code})};
    await assert.rejects(transfer(input), error => (error.uncertain === true) === uncertain &&
      (!uncertain || error.action === 'preview-source-push') && !error.message.includes('private'));
    cleaned();
  }
  for (const command of ['clone', 'ls-remote']) {
    reset(); failure = {command, error: Object.assign(Error('private read stderr'), {code: 'ETIMEDOUT'})};
    await assert.rejects(transfer(input), error => !error.uncertain && !error.message.includes('private'));
    assert.equal(pushes.length, 0); cleaned();
  }
  reset(); advertised = 'ref: refs/heads/other\tHEAD\n' + sha + '\tHEAD';
  await assert.rejects(transfer(input), /default branch changed/); assert.equal(pushes.length, 0);
  reset(); sourceRefs = [[historicalSha, 'refs/tags/tag-only']];
  await assert.rejects(transfer(input), /default branch changed/); assert.equal(pushes.length, 0);
  reset();
  await assert.rejects(transfer({...input, approvedFiles: [{path: '.gitlab/primary.yml', sha256: '0'.repeat(64)}]}), /producers differ/);
  assert.equal(pushes.length, 0);
  dns.lookup = async () => [{address: '169.254.169.254'}];
  await assert.rejects(transfer(input), /public network/); assert.equal(pushes.length, 0);
  dns.lookup = async () => [{address: '1.1.1.1'}];

  // Real bare Git repositories verify two server-side receive transactions and
  // actual push options, not just the client's argument construction.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-real-ref-transfer-'));
  try {
    const source = path.join(directory, 'source'), target = path.join(directory, 'target.git'), events = path.join(directory, 'receives');
    fs.mkdirSync(source); fixtureGit(source, 'init', '--quiet', '--initial-branch=master');
    fs.mkdirSync(path.join(source, '.gitlab')); fs.writeFileSync(path.join(source, '.gitlab/primary.yml'), producers);
    fixtureGit(source, 'add', '.'); fixtureGit(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Native CI fixture');
    for (let n = 0; n < 7; n++) fixtureGit(source, 'branch', 'codex/history-' + n);
    fixtureGit(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'tag', '-a', 'v0.1.0', '-m', 'Historical tag', '--no-sign', '--', 'HEAD');
    fixtureGit(directory, 'init', '--quiet', '--bare', '--initial-branch=master', target);
    fixtureGit(target, 'config', 'receive.advertisePushOptions', 'true');
    fs.writeFileSync(path.join(target, 'hooks/pre-receive'), '#!/bin/sh\nset -eu\nprintf "push:%s:%s\\n" "${GIT_PUSH_OPTION_COUNT:-0}" "${GIT_PUSH_OPTION_0:-}" >> "$PREVIEW_TEST_RECEIVES"\ncat >> "$PREVIEW_TEST_RECEIVES"\n', {mode: 0o755});
    const previousEvents = process.env.PREVIEW_TEST_RECEIVES;
    process.env.PREVIEW_TEST_RECEIVES = events;
    native = {source, destination: target};
    try {
      assert.equal((await transfer(input)).imported, true);
      const transactions = fs.readFileSync(events, 'utf8').split('push:').filter(Boolean);
      assert.equal(transactions.length, 2);
      assert(transactions[0].startsWith('0:\n')); assert.equal(transactions[0].trim().split('\n').length, 2);
      assert(transactions[0].includes(' ' + master));
      assert(transactions[1].startsWith('1:ci.skip\n')); assert(!transactions[1].includes(' ' + master));
      assert.equal(fixtureGit(target, 'for-each-ref', '--format=%(refname)').split('\n').length, 9);
      assert.equal((await transfer(input)).unchanged, true);
      assert.equal(fs.readFileSync(events, 'utf8').split('push:').length - 1, 2);
      const resume = path.join(directory, 'resume.git'), reject = path.join(directory, 'reject-history');
      fixtureGit(directory, 'init', '--quiet', '--bare', '--initial-branch=master', resume);
      fixtureGit(resume, 'config', 'receive.advertisePushOptions', 'true');
      fs.writeFileSync(reject, 'reject one historical transaction');
      fs.writeFileSync(path.join(resume, 'hooks/pre-receive'), '#!/bin/sh\nset -eu\ncat >/dev/null\nif [ "${GIT_PUSH_OPTION_0:-}" = ci.skip ] && [ -e "' + reject + '" ]; then rm -- "' + reject + '"; exit 1; fi\n', {mode: 0o755});
      native.destination = resume;
      await assert.rejects(transfer(input), error => error.uncertain === true && error.action === 'preview-source-push');
      assert.equal(fixtureGit(resume, 'for-each-ref', '--format=%(refname)'), master);
      assert.equal((await transfer(input)).imported, true, 'Exact default-only state can resume after an inspected settled Git rejection');
      assert.equal(fixtureGit(resume, 'for-each-ref', '--format=%(refname)').split('\n').length, 9);
    } finally {
      native = undefined;
      if (previousEvents === undefined) delete process.env.PREVIEW_TEST_RECEIVES;
      else process.env.PREVIEW_TEST_RECEIVES = previousEvents;
    }
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
  console.log('Preview source transfer: default-first native CI, separate atomic historical ci.skip, exact partial/full retries, conservative uncertain mutations, producer/credential guards and actual bare-Git receive transactions passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {child.execFile = originalExec; dns.lookup = originalLookup;});
