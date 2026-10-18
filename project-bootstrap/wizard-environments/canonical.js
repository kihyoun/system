'use strict';
// This source is sent on stdin to node in the ORIGINAL controller. Never return
// configuration text, credentials, environment dumps, or private key contents.
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const file = '/system/system/.projects.env/.wizard.env';
const lock = file + '.environments.lock';
const prefix = '# BOOTSTRAPPER_PROJECT=';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function read() {
  const text = fs.readFileSync(file, 'utf8');
  if (text[807] !== '$' || crypto.createHash('md5').update(text.slice(0, 1184)).digest('hex') !== 'bd4a8426355824593a5e21ad759830c1')
    throw new Error('signature');
  const lines = text.split('\n').filter(line => line.startsWith(prefix));
  if (lines.length !== 1) throw new Error('receipt');
  const receipt = JSON.parse(Buffer.from(lines[0].slice(prefix.length), 'base64').toString());
  if (!receipt.defaultProject || receipt.template !== 'wizard' || receipt.state !== 'complete' || !receipt.repository?.systemProject ||
      receipt.repository.ciPath !== '.system-bootstrapper/ci.yml') throw new Error('ownership');
  const allowed = new Set(['WIZARD_HOST', 'GITLAB_HOST', 'GITLAB_REGISTRY_HOST', 'GITLAB_REGISTRY_URL', 'GITLAB_REGISTRY_DOMAIN_MODE']);
  const publicSettings = {};
  for (const line of fs.readFileSync('/system/system/.docker.env', 'utf8').split('\n')) {
    const match = /^(?:export )?([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/.exec(line);
    if (match && allowed.has(match[1])) publicSettings[match[1]] = match[2] ?? match[3] ?? match[4];
  }
  const registry = new URL(publicSettings.GITLAB_REGISTRY_URL);
  if (registry.username || registry.password || registry.pathname !== '/' || registry.search || registry.hash) throw new Error('registry');
  return {text, receipt, publicSettings, contentHash: sha(text)};
}
async function run(action, payload) {
  if (action !== 'read' && action !== 'dns' && !/^[a-f0-9]{48}$/.test(payload.token || '')) throw new Error('token');
  const cancelled = file + '.environments-cancel-' + payload.token;
  if (action === 'unlock') {
    // Unlock by the acquired owner token even if an external administrator
    // changed the reservation while this helper was running.
    // Durable token cancellation also covers a lost acquisition response: a
    // delayed lock command must not acquire after its helper has given up.
    fs.writeFileSync(cancelled, payload.token, {mode: 0o600});
    let owner;
    try { owner = JSON.parse(fs.readFileSync(lock + '/owner', 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {ok: true, notOwned: true}; throw error; }
    if (owner.token !== payload.token) throw new Error('lock-owner');
    fs.unlinkSync(lock + '/owner'); fs.rmdirSync(lock);
    return {ok: true};
  }
  if (action === 'lock') {
    if (fs.existsSync(cancelled)) throw new Error('cancelled');
    fs.mkdirSync(lock, {mode: 0o700});
    const acquired = fs.statSync(lock);
    const sameDirectory = () => {
      try { const now = fs.statSync(lock); return now.dev === acquired.dev && now.ino === acquired.ino; }
      catch (_) { return false; }
    };
    try {
      // The backend uses the same lock. Re-read after acquiring it rather
      // than relying on a reservation observed before mkdir succeeded.
      const environment = read().receipt.wizardWorkflow?.environments;
      if (!environment || environment.operation !== payload.operation || environment.controller !== 'system_bootstrapper_1')
        throw new Error('reservation');
      fs.writeFileSync(lock + '/owner', JSON.stringify({token: payload.token, helper: payload.helper}), {flag: 'wx', mode: 0o600});
      if (fs.existsSync(cancelled)) throw new Error('cancelled');
      return {ok: true};
    } catch (error) {
      // An uncertain-acquisition unlock may already have released this
      // directory. Never remove a subsequently acquired replacement mutex.
      if (sameDirectory()) {
        let own = true;
        try { own = JSON.parse(fs.readFileSync(lock + '/owner', 'utf8')).token === payload.token; }
        catch (ownerError) { own = ownerError.code === 'ENOENT'; }
        if (own && sameDirectory()) {
          try { fs.unlinkSync(lock + '/owner'); } catch (_) { /* owner was not created */ }
          if (sameDirectory()) { try { fs.rmdirSync(lock); } catch (_) { /* another owner must reconcile */ } }
        }
      }
      throw error;
    }
  }
  const current = read();
  if (action === 'read') {
    const receipt = current.receipt;
    return {receipt: {operation: receipt.operation, namespaceId: receipt.namespaceId,
      repository: {id: receipt.repository.id, path: receipt.repository.path, defaultBranch: receipt.repository.defaultBranch,
        ciPath: receipt.repository.ciPath, systemProject: receipt.repository.systemProject}, wizardWorkflow: receipt.wizardWorkflow},
      publicSettings: current.publicSettings, contentHash: current.contentHash};
  }
  const environment = current.receipt.wizardWorkflow?.environments;
  if (!environment || environment.operation !== payload.operation || environment.controller !== 'system_bootstrapper_1') throw new Error('reservation');
  if (action === 'cas') {
    const owner = JSON.parse(fs.readFileSync(lock + '/owner', 'utf8'));
    if (owner.token !== payload.token || current.contentHash !== payload.expectedHash) throw new Error('receipt-raced');
    if (JSON.stringify(payload.deployments).length > 100000) throw new Error('receipt-size');
    environment.deployments = payload.deployments;
    const next = current.text.split('\n').map(line => line.startsWith(prefix) ? prefix + Buffer.from(JSON.stringify(current.receipt)).toString('base64') : line).join('\n');
    const temporary = file + '.environments-' + payload.token;
    fs.writeFileSync(temporary, next, {flag: 'wx', mode: 0o600});
    try { fs.renameSync(temporary, file); } catch (error) { fs.unlinkSync(temporary); throw error; }
    return {ok: true, contentHash: sha(next)};
  }
  if (action === 'dns') {
    const production = await dns.lookup(current.publicSettings.WIZARD_HOST, {all: true});
    const addresses = new Set(production.map(row => row.address));
    if (!addresses.size) throw new Error('production-dns');
    for (const kind of ['review', 'beta']) {
      const setting = environment.settings[kind];
      if (!setting.enabled) continue;
      if (setting.host === current.publicSettings.WIZARD_HOST) throw new Error('production-conflict');
      const candidate = await dns.lookup(setting.host, {all: true});
      if (!candidate.length || candidate.some(row => !addresses.has(row.address))) throw new Error('candidate-dns');
    }
    return {ok: true};
  }
  throw new Error('action');
}
if (require.main === module) {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; if (input.length > 300000) process.exit(2); });
  process.stdin.on('end', async () => {
    try { const args = JSON.parse(input); console.log(JSON.stringify(await run(args.action, args.payload))); }
    catch (_) { console.log(JSON.stringify({ok: false, message: 'Canonical Wizard ownership, reservation, lock, DNS, or receipt check failed.'})); process.exitCode = 1; }
  });
}
module.exports = {run};
