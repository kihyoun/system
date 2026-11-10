'use strict';
// Source installations retain provenance and the running bytes, without
// claiming a product release or successful acceptance of those bytes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {signature} = require('../wizard-production/run');
const {validate: validateSnapshot} = require('../wizard-source/package');
const FORMAT = 'system-source-installation-v1';
const FILE = '.source-installation.json';
const imageId = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fail = () => { throw Error('Retain the exact running source installation, private provenance record and immutable controller/Wizard selectors.'); };
function setting(content, key) {
  let value;
  for (const line of content.split('\n')) {
    const match = /^(?:export )?([A-Z_]+)=(?:"([^"$`\\]*)"|'([^']*)'|([A-Za-z0-9_./:@+-]+))\s*$/.exec(line);
    if (match?.[1] === key) value = match[2] ?? match[3] ?? match[4];
  }
  return value;
}
function keys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
}
function privateRecord(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o777) !== 0o600 || metadata.size > 1048576) fail();
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch (_) { fail(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function validate(record, main) {
  signature(main);
  if (!keys(record, ['format', 'status', 'sourceCommit', 'sourceTree', 'wizardSourceRevision', 'images', 'recordedAt']) ||
      record.format !== FORMAT || record.status !== 'recorded' || !sha(record.sourceCommit) || !sha(record.sourceTree) ||
      !sha(record.wizardSourceRevision) || typeof record.recordedAt !== 'string' || !Number.isFinite(Date.parse(record.recordedAt)) ||
      !keys(record.images, ['controller', 'wizard'])) fail();
  for (const role of ['controller', 'wizard']) {
    const image = record.images[role];
    if (!keys(image, ['reference', 'imageId', 'candidateJobId', 'platform']) || !imageId(image.imageId) ||
        image.reference !== image.imageId || image.platform !== 'linux/amd64' ||
        !Number.isSafeInteger(image.candidateJobId) || image.candidateJobId < 1 ||
        setting(main, role === 'controller' ? 'BOOTSTRAPPER_IMAGE' : 'WIZARD_IMAGE') !== image.imageId) fail();
  }
  if (record.images.controller.imageId === record.images.wizard.imageId ||
      record.images.controller.candidateJobId !== record.images.wizard.candidateJobId) fail();
  return record;
}
function docker(arguments_) {
  const environment = {...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock'};
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete environment[key];
  try {
    const rows = JSON.parse(execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...arguments_],
      {env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe']}));
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') fail();
    return rows[0];
  } catch (_) { fail(); }
}
function provenance(record, options = {}) {
  const inspect = options.inspect || docker;
  const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(options.snapshotFile || path.join(__dirname, '../wizard-source/snapshot.json'), 'utf8')));
  if (snapshot.sourceRevision !== record.wizardSourceRevision) fail();
  for (const role of ['controller', 'wizard']) {
    const selected = record.images[role];
    const name = role === 'controller' ? 'system_bootstrapper_1' : 'system_wizard_1';
    const current = inspect(['container', 'inspect', name]);
    if (current.Name !== '/' + name || current.State?.Running !== true || current.Image !== selected.imageId) fail();
    const image = inspect(['image', 'inspect', selected.imageId]);
    const labels = image.Config?.Labels;
    if (image.Id !== selected.imageId || image.Os !== 'linux' || image.Architecture !== 'amd64' ||
        labels?.['org.opencontainers.image.revision'] !== (role === 'controller' ? record.sourceCommit : record.wizardSourceRevision) ||
        labels?.['org.system-bootstrapper.source-tree'] !== record.sourceTree ||
        labels?.['org.system-bootstrapper.test-job'] !== String(selected.candidateJobId) ||
        (role === 'wizard' && labels?.['org.system-bootstrapper.source-revision'] !== record.sourceCommit)) fail();
  }
  return record;
}
function sourceInstallation(main, options = {}) {
  try {
    const mainConfig = options.mainConfig || '/state/.docker.env';
    const filename = path.join(path.dirname(mainConfig), FILE);
    const record = validate(privateRecord(filename), main);
    provenance(record, options);
    if (fs.readFileSync(mainConfig, 'utf8') !== main) fail();
    return record.images.wizard.imageId;
  } catch (_) { fail(); }
}
function recordInstallation(expected, options = {}) {
  if (process.getuid() !== 0 || !keys(expected, ['controller', 'wizard', 'sourceCommit', 'sourceTree', 'wizardSourceRevision']) ||
      !imageId(expected.controller) || !imageId(expected.wizard) || !sha(expected.sourceCommit) ||
      !sha(expected.sourceTree) || !sha(expected.wizardSourceRevision)) fail();
  const mainConfig = options.mainConfig || '/state/.docker.env';
  const directory = path.dirname(mainConfig), filename = path.join(directory, FILE);
  if (fs.lstatSync(directory).isSymbolicLink()) fail();
  const main = fs.readFileSync(mainConfig, 'utf8');
  const inspect = options.inspect || docker;
  const images = {};
  for (const role of ['controller', 'wizard']) {
    const image = inspect(['image', 'inspect', expected[role]]);
    const job = image.Config?.Labels?.['org.system-bootstrapper.test-job'];
    if (typeof job !== 'string' || !/^[1-9][0-9]*$/.test(job) || !Number.isSafeInteger(Number(job))) fail();
    images[role] = {reference: expected[role], imageId: expected[role], candidateJobId: Number(job), platform: 'linux/amd64'};
  }
  const record = {format: FORMAT, status: 'recorded', sourceCommit: expected.sourceCommit,
    sourceTree: expected.sourceTree, wizardSourceRevision: expected.wizardSourceRevision, images,
    recordedAt: new Date().toISOString()};
  validate(record, main); provenance(record, options);
  if (fs.existsSync(filename)) {
    const previous = validate(privateRecord(filename), main);
    provenance(previous, options);
    if (JSON.stringify({...previous, recordedAt: record.recordedAt}) !== JSON.stringify(record)) fail();
    return previous;
  }
  if (fs.readFileSync(mainConfig, 'utf8') !== main) fail();
  // Persist without replacing an existing provenance record, including one
  // created by a concurrent operator. No startup selectors are written here.
  const temporary = path.join(directory, '.' + FILE + '-' + crypto.randomBytes(12).toString('hex'));
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(record, null, 2) + '\n'); fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.linkSync(temporary, filename);
    const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return record;
}
module.exports = {sourceInstallation, recordInstallation, validate, provenance, privateRecord, FORMAT, FILE};
