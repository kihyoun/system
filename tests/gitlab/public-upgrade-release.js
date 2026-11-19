'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {publicUpgrade} = require('../../gitlab/public-upgrade-release');
const root = path.resolve(__dirname, '../..');
function fixture() {
  const script = "import importlib.util,json; s=importlib.util.spec_from_file_location('fixture','tests/bootstrapper/public-upgrade.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.fixture()))";
  const result = spawnSync('python3', ['-c', script], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const [metadata, proof, security] = JSON.parse(result.stdout);
  const jobs = proof.publication.jobs.map(row => ({...row, pipeline: {id: row.pipelineId}, commit: {id: row.sourceRevision}}));
  return {metadata, proof, security, jobs};
}
test('sanitized public proof round-trips through native Python verifier without private artifact access', () => {
  const {metadata, proof, security, jobs} = fixture();
  proof.evidence.privateAddress = 'must-never-publish.internal';
  proof.evidence.evidence.privateConfiguration = 'private-fixture-password';
  proof.evidence.results[0].rawLog = 'private-fixture-password';
  const assets = publicUpgrade(metadata, proof.release, proof.evidence, proof.graph, jobs);
  const payload = Object.values(assets)[0];
  assert(!payload.toString().includes('must-never-publish'));
  assert(!payload.toString().includes('private-fixture-password'));
  assert(!payload.toString().includes('registry.example.invalid'));
  const script = "import sys,json;sys.path.insert(0,'bootstrapper');from public_release import PublicReleaseAuthority;v=json.load(sys.stdin);a=PublicReleaseAuthority(v['metadata'],v['proof'].encode(),'https://operator.example.invalid',v['security']);print(a.metadata['version'])";
  const result = spawnSync('python3', ['-c', script], {cwd: root, encoding: 'utf8',
    input: JSON.stringify({metadata, proof: payload.toString(), security})});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), metadata.version);
});
test('publisher refuses an untested transition, failed runtime check or false preservation claim', () => {
  for (const change of [proof => proof.results.pop(), proof => { proof.results.at(-1).status = 'failed'; },
    proof => { proof.evidence.publicUpgrade.rollbackVerified = false; },
    proof => { proof.evidence.publicUpgrade.fromVersion = 'unknown'; }]) {
    const {metadata, proof, jobs} = fixture(); change(proof.evidence);
    assert.throws(() => publicUpgrade(metadata, proof.release, proof.evidence, proof.graph, jobs), /matching candidate proof/);
  }
});
