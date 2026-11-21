'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// This inventory covers only the current portable runtime's three generated
// copies. Other generated files and historical recipes remain scan inputs.
const artifacts = Object.freeze([
  'project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs',
  'wizard/.gitlab/runtime/project-ci.cjs',
  'wizard/.system-bootstrapper/build-v2/runtime/project-ci.cjs',
]);
const producerPath = 'wizard/.gitlab/producer-v2.json';
const generator = 'operations/scripts/bundle-project-ci.mjs';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function verifiedGeneratedArtifacts(root, entries) {
  const committed = new Map(entries.map(entry => [entry.name, entry]));
  const present = artifacts.filter(name => committed.has(name));
  if (!present.length) return [];
  if (present.length !== artifacts.length)
    throw Error('Portable generated runtime inventory is incomplete.');
  const read = name => {
    const entry = committed.get(name);
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw Error('Portable generated runtime input must be a committed regular file: ' + name);
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error('Portable generated runtime input must be a regular file: ' + name);
    return fs.readFileSync(file);
  };
  const runtime = read(artifacts[0]);
  if (!runtime.toString('utf8').startsWith('// Generated from compiled shared operations; run ' + generator + '.\n'))
    throw Error('Portable generated runtime has an unknown generator.');
  for (const name of artifacts.slice(1))
    if (!read(name).equals(runtime)) throw Error('Portable generated runtime copies differ.');
  const runtimeSha256 = hash(runtime);
  const producer = JSON.parse(read(producerPath).toString('utf8'));
  if (producer.version !== 2 || producer.runtime !== '.gitlab/runtime/project-ci.cjs' ||
      producer.buildProfile !== 'node24-vite8-typed-v6' || producer.runtimeSha256 !== runtimeSha256)
    throw Error('Portable generated runtime producer identity or SHA-256 differs.');
  const licenses = artifacts.map(name => path.posix.join(path.posix.dirname(name), 'LICENSES.txt'));
  const license = read(licenses[0]);
  if (!license.toString('utf8').startsWith('Bundled project CI runtime licenses\n\nSystem Bootstrapper\n'))
    throw Error('Portable generated runtime license notice is missing.');
  for (const name of licenses.slice(1))
    if (!read(name).equals(license)) throw Error('Portable generated runtime license copies differ.');
  return artifacts.map((name, index) => ({path: name, sha256: runtimeSha256,
    license: {path: licenses[index], sha256: hash(license)}, producer: producerPath, generator}));
}

module.exports = {verifiedGeneratedArtifacts};
