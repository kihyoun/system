'use strict';
const {execFile} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
function run(args, options = {}) {
  const {trim = true, mutating = false, ...execution} = options;
  return new Promise((resolve, reject) => execFile('git', args, {timeout: 240000, maxBuffer: 4000000, ...execution}, (error, stdout) => {
    // Git errors can include authentication material; return a fixed diagnostic.
    if (error) reject(Object.assign(Error('Source transfer failed. Inspect project ownership and remote refs before explicitly resuming.'),
      mutating && !['ENOENT', 'EACCES'].includes(error.code) ? {uncertain: true, action: 'preview-source-push'} : {}));
    else resolve(trim ? stdout.trim() : stdout);
  }));
}
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b) || a === 192 && b === 0 && [0, 2].includes(c) || a === 192 && b === 88 && c === 99 || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  return net.isIPv6(address) && /^[23][a-f0-9]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
function gitEnvironment() {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|PREVIEW_GIT_|SSH_ASKPASS)/.test(key)));
  return {...environment, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_LFS_SKIP_SMUDGE: '1'};
}
async function originPreflight(origin) {
  const url = new URL(origin);
  const addresses = await dns.lookup(url.hostname, {all: true});
  if (!addresses.length || addresses.some(row => !publicAddress(row.address))) throw Error('The source origin must resolve only to public network addresses.');
  // Disable redirects and prompts for every source read; credentials are never sent upstream.
  const pins = addresses.flatMap(row => ['-c', 'http.curloptResolve=' + url.hostname + ':443:' + (row.address.includes(':') ? '[' + row.address + ']' : row.address)]);
  // Git receives the already validated addresses; it cannot resolve the host
  // again between validation and transfer. Disable proxy re-resolution too.
  return {pins, head: await run([...pins, '-c', 'http.followRedirects=false', '-c', 'http.proxy=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', 'ls-remote', '--symref', origin, 'HEAD'], {env: gitEnvironment(), cwd: os.tmpdir()})};
}
async function transfer({origin, destination, token, username = 'oauth2', approvedFiles = []}) {
  const verified = await originPreflight(origin);
  const url = new URL(destination);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !token) throw Error('Use the configured TLS GitLab destination and a scoped temporary repository credential.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrapper-preview-source-'));
  try {
    const sourceEnv = gitEnvironment();
    await run([...verified.pins, '-c', 'http.followRedirects=false', '-c', 'http.proxy=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', 'clone', '--bare', '--', origin, path.join(directory, 'source.git')], {env: sourceEnv, cwd: directory});
    for (const file of approvedFiles) {
      const content = await run(['show', 'HEAD:' + file.path], {cwd: path.join(directory, 'source.git'), env: sourceEnv, trim: false});
      if (crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) throw Error('Source CI producers differ from the accepted controller. No refs were pushed; use the explicit reviewed source-primary path.');
    }
    const askpass = path.join(directory, 'askpass');
    fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s" "$PREVIEW_GIT_USERNAME";; *) printf "%s" "$PREVIEW_GIT_TOKEN";; esac\n', {mode: 0o700});
    const env = {...sourceEnv, GIT_ASKPASS: askpass, PREVIEW_GIT_USERNAME: username, PREVIEW_GIT_TOKEN: token};
    const cwd = path.join(directory, 'source.git');
    const refs = (await run(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags'], {cwd, env: sourceEnv})).split('\n').filter(Boolean).map(line => line.split(' '));
    if (!refs.length || refs.length > 500) throw Error('Import requires a bounded source repository with at least one branch.');
    const defaultRef = await run(['symbolic-ref', '--quiet', 'HEAD'], {cwd, env: sourceEnv});
    const advertised = verified.head.split('\n');
    const defaultHead = refs.find(([, name]) => name === defaultRef);
    if (!/^refs\/heads\//.test(defaultRef) || !defaultHead ||
        !advertised.includes('ref: ' + defaultRef + '\tHEAD') ||
        !advertised.includes(defaultHead[0] + '\tHEAD')) throw Error('The source default branch changed or is unavailable. No refs were pushed; run preflight again.');
    const historical = refs.filter(([, name]) => name !== defaultRef);
    const actualRefs = async () => (await run(['-c', 'http.followRedirects=false', 'ls-remote', '--heads', '--tags', destination], {env}))
      .split('\n').filter(Boolean).filter(line => !line.endsWith('^{}') && /\srefs\/(?:heads|tags)\//.test(line)).map(line => line.split(/\s+/));
    const same = (actual, expected) => actual.length === expected.length &&
      actual.every(([sha, name]) => expected.some(([expectedSha, expectedName]) => sha === expectedSha && name === expectedName));
    const conflict = () => Error('The imported project contains changed or additional refs. Preserve operator edits and reconcile manually.');
    let actual = await actualRefs();
    // Only an exact complete import or our exact default-only intermediate
    // state can resume. Never turn arbitrary partial/operator refs into leases.
    if (same(actual, refs)) return {unchanged: true};
    if (actual.length && !same(actual, [defaultHead])) throw conflict();
    const push = async (selected, skipCI) => run(['-c', 'http.followRedirects=false', 'push', '--atomic', '--no-follow-tags',
      ...(skipCI ? ['--push-option=ci.skip'] : []), ...selected.map(([, name]) => '--force-with-lease=' + name + ':'),
      destination, ...selected.map(([, name]) => name + ':' + name)], {cwd, env, mutating: true});
    if (!actual.length) {
      // GitLab bounds pipelines per push. Give the source default branch its
      // own ordinary push, so historical refs cannot displace its native CI.
      await push([defaultHead], false);
      actual = await actualRefs();
      if (same(actual, refs)) return {imported: true};
      if (!same(actual, [defaultHead])) throw conflict();
    }
    // Preserve history without running obsolete branch/tag CI. The candidate's
    // default-branch pipeline above is never skipped or recreated through API.
    await push(historical, true);
    if (!same(await actualRefs(), refs)) throw conflict();
    return {imported: true};
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
module.exports = {transfer, originPreflight, publicAddress};
