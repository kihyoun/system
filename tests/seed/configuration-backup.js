'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {validateBackup} = require('../../system/seed-operation');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'configuration-zip-contract-'));
const cube = fs.readFileSync(path.join(__dirname, '../../system/.docker.env.example')).subarray(0, 1184);
// Python emits actual old/new ZIPs, not a mocked unzip listing.
function archive(name, entries, link = false) {
  const file = path.join(root, name + '.zip');
  const script = 'import json,sys,zipfile\nf=zipfile.ZipFile(sys.argv[1],"w")\n' +
    'for name,content in json.loads(sys.argv[2]).items():\n info=zipfile.ZipInfo(name)\n info.create_system=3\n info.external_attr=(0o120777 if sys.argv[3]=="link" else 0o100600)<<16\n f.writestr(info,content)\nf.close()\n';
  const result = spawnSync('python3', ['-c', script, file, JSON.stringify(entries), link ? 'link' : 'regular']);
  assert.equal(result.status, 0, result.stderr?.toString()); return file;
}
try {
  const old = {'.docker.env': cube + '\nGITLAB_RUNNER_SCALE="0"\nBOOTSTRAPPER_IMAGE="example/old-controller@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\nWIZARD_IMAGE="example/old-wizard:old"\n', 'bootstrapper.json': '{}', '.projects.env/.sample.env': cube + '\nPROJECT_NAME="sample"\n'};
  validateBackup(archive('legacy', old));
  validateBackup(archive('recovery', {...old, 'recovery.json': '{"format":"system-configuration-recovery-v1"}', 'RECOVERY.md': '# Restore\n'}));
  for (const name of ['../outside', 'recovery.json/evil', '/absolute', '.projects.env/../../outside', 'runtime.sh'])
    assert.throws(() => validateBackup(archive('unsafe', {...old, [name]: 'payload'})), /invalid-configuration-backup/);
  assert.throws(() => validateBackup(archive('link', old, true)), /unsafe-configuration-backup-entry/);
  // The ordinary Push path ignores metadata, including fields pretending to be authority.
  const project = path.join(root, 'project'), system = path.join(project, 'system'), state = path.join(root, 'state');
  fs.mkdirSync(system, {recursive: true}); fs.mkdirSync(state);
  fs.copyFileSync(path.join(__dirname, '../../system/push.sh'), path.join(system, 'push.sh'));
  fs.symlinkSync(path.join(__dirname, '../../nginx'), path.join(project, 'nginx'));
  fs.symlinkSync(path.join(__dirname, '../../project-bootstrap'), path.join(project, 'project-bootstrap'));
  const malicious = {...old, 'recovery.json': JSON.stringify({savedImages: {controller: {reference: 'attacker/latest'}}, seed: {verified: true}}),
    'RECOVERY.md': 'descriptive only'};
  fs.copyFileSync(archive('push', malicious), path.join(project, 'bootstrapper.zip'));
  const pushed = spawnSync('bash', ['push.sh'], {cwd: system, env: {...process.env, SYSTEM_CONFIG_DIR: state}, encoding: 'utf8'});
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(fs.readFileSync(path.join(state, '.docker.env'), 'utf8'), old['.docker.env']);
  assert.equal(fs.existsSync(path.join(state, 'recovery.json')), false);
  assert.equal(fs.existsSync(path.join(state, 'RECOVERY.md')), false);
  console.log('PASS actual old/new configuration ZIP validation and data-only Push compatibility.');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
