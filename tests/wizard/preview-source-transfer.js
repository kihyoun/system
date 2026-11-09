'use strict';
const assert = require('assert');
const fs = require('fs');
const dns = require('dns').promises;
const child = require('child_process');
const originalExec = child.execFile, originalLookup = dns.lookup;
const sha = 'a'.repeat(40), destination = 'https://gitlab.example.test/team/fork.git';
let actual = '', pushes = 0, failure;
const calls = [];
dns.lookup = async () => [{address: '1.1.1.1'}];
child.execFile = (command, args, options, callback) => {
  assert.equal(command, 'git'); calls.push({args, options});
  if (failure && args.includes(failure.command)) { callback(failure.error, ''); return; }
  let output = '';
  if (args.includes('clone')) {assert(args.includes('http.curloptResolve=source.example.test:443:1.1.1.1')); assert(args.includes('protocol.allow=never')); assert(args.includes('http.proxy=')); assert(!options.env.PREVIEW_GIT_TOKEN); fs.mkdirSync(args.at(-1));}
  else if (args.includes('for-each-ref')) output = sha + ' refs/heads/master\n' + sha + ' refs/tags/v1.0.0';
  else if (args.includes('ls-remote') && args.includes(destination)) output = actual;
  else if (args.includes('ls-remote')) {assert(args.includes('http.curloptResolve=source.example.test:443:1.1.1.1')); assert(!options.env.PREVIEW_GIT_TOKEN); output = 'ref: refs/heads/master\tHEAD\n' + sha + '\tHEAD';}
  else if (args.includes('push')) {
    pushes++;
    assert(args.includes('--atomic'));
    assert(args.includes('--force-with-lease=refs/heads/master:'));
    assert(args.includes('--force-with-lease=refs/tags/v1.0.0:'));
    assert.equal(options.env.PREVIEW_GIT_TOKEN, 'fixture-scoped-token');
    assert(!args.join(' ').includes('fixture-scoped-token'));
    assert(fs.existsSync(options.env.GIT_ASKPASS));
  } else throw Error('Unexpected Git action');
  callback(null, output);
};
const {transfer} = require('../../project-bootstrap/preview-setup/source');
const input = {origin: 'https://source.example.test/fork.git', destination, token: 'fixture-scoped-token'};
(async () => {
  assert.equal((await transfer(input)).imported, true); assert.equal(pushes, 1);
  for (const row of calls.filter(row => row.options.env.GIT_ASKPASS)) assert(!fs.existsSync(row.options.env.GIT_ASKPASS), 'Temporary credential helper survived transfer');
  actual = sha + '\tHEAD\n' + sha + '\trefs/heads/master\n' + sha + '\trefs/tags/v1.0.0';
  assert.equal((await transfer(input)).unchanged, true); assert.equal(pushes, 1, 'Lost-response recovery pushed again');
  actual += '\n' + 'b'.repeat(40) + '\trefs/heads/operator-edits';
  await assert.rejects(transfer(input), /changed or additional refs/); assert.equal(pushes, 1);
  dns.lookup = async () => [{address: '169.254.169.254'}];
  await assert.rejects(transfer(input), /public network/); assert.equal(pushes, 1);
  dns.lookup = async () => [{address: '1.1.1.1'}]; actual = '';
  for (const [command, code, uncertain] of [['push','ETIMEDOUT',true], ['push','ECONNRESET',true], ['push','ENOENT',false], ['clone','ETIMEDOUT',false], ['ls-remote','ETIMEDOUT',false]]) {
    failure = {command, error:Object.assign(Error('private transport stderr'), {code})};
    await assert.rejects(transfer(input), error => (error.uncertain === true) === uncertain && !error.message.includes('private'));
  }
  console.log('Preview source transfer: native atomic pushes, empty-ref leases, no upstream credentials, exact-ref lost-response recovery, operator-edit refusal and credential-helper cleanup passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {child.execFile = originalExec; dns.lookup = originalLookup;});
