const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {spawnSync} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-cleanup-'));
try {
  fs.mkdirSync(path.join(root, 'bin'));
  const helper = path.join(root, 'cleanup.sh');
  fs.writeFileSync(helper, fs.readFileSync(path.join(__dirname, '../../project-bootstrap/wizard-build/recipe/cleanup.sh'), 'utf8').replace(/\r\n/g, '\n'));
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!${process.execPath}
const args=process.argv.slice(2), mode=process.env.CLEANUP_MODE;
require('fs').appendFileSync(process.env.TRACE,JSON.stringify(args)+'\\n');
if(mode==='offline')process.exit(1);
if(args.includes('ls')){
 if(mode==='absent')process.exit(0);
 if(args[0]==='buildx'){console.log('wizard-build-1-2');process.exit(0);}
 const filter=args[args.indexOf('--filter')+1]||'';
 let name=filter.replace(/^name=\\^\\/?/,'').replace(/\\$$/,'').replace(/^reference=/,'');
 console.log(name);process.exit(0);
}
if(mode==='remove-failed' && args.includes('rm'))process.exit(1);
process.exit(0);
`, {mode: 0o755});
  function run(mode, primary) {
    const trace = path.join(root, 'trace'); fs.writeFileSync(trace, '');
    const result = spawnSync('sh', ['-c', '. "$1"; builder=wizard-build-1-2; image=registry.localhost/root/wizard:fixture; trap wizard_on_exit EXIT; exit "$PRIMARY"', '--', helper],
      {cwd: root, env: {...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH, CLEANUP_MODE: mode, PRIMARY: String(primary), TRACE: trace}, encoding: 'utf8', timeout: 10000});
    assert(!result.error, result.error?.message);
    const cleanup = JSON.parse(fs.readFileSync(path.join(root, 'cleanup.json'), 'utf8'));
    return {result, cleanup, calls: fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)};
  }
  for (const mode of ['absent', 'present']) {
    const {result, cleanup, calls} = run(mode, 0);
    assert.equal(result.status, 0, result.stderr); assert.equal(cleanup.status, 'passed');
    assert(calls.every(args => !args.includes('prune')));
  }
  for (const mode of ['offline', 'remove-failed']) {
    const {result, cleanup} = run(mode, 0);
    assert.equal(result.status, 1); assert.equal(cleanup.status, 'failed');
    assert(result.stderr.includes('cleanup failed'));
    assert.equal(run(mode, 7).result.status, 7, 'Cleanup masked the primary failure');
  }
  console.log('Wizard cleanup: absent resources, daemon/removal failures, bounded owned cleanup and primary exit preservation passed.');
} finally {fs.rmSync(root, {recursive: true, force: true});}
