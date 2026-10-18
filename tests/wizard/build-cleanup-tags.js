'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const recipes = require('../../project-bootstrap/wizard-build/recipe');
const logo = fs.readFileSync(path.join(__dirname, '../../sync/src/Helper.ts'), 'utf8').match(/return `([\s\S]*?)`;/)[1];
const historical = {
  legacy: 'd6f99917add408077ad732621f717bb545566e75c98c896624bd606c00a0c406',
  'node24-vite8': 'd0d8fcd0e325cdf806f2f5fec6aec59481f13dea78c475f7f69c8764db947360'
};
for (const [profile, recipeHash] of Object.entries(historical)) {
  const recipe = recipes.generate(logo, profile);
  assert.equal(recipe.recipeHash, recipeHash, 'Historical recipe bytes and receipt proofs must remain identical');
  assert.deepEqual(recipes.select(logo, recipeHash), recipe);
  const corrected = recipes.generate(logo, profile + '-cleanup-v2');
  assert.notEqual(corrected.recipeHash, recipeHash);
  assert.deepEqual(recipes.select(logo, corrected.recipeHash), corrected);
  assert.equal(corrected.ci, recipe.ci);
  for (const file of recipe.files.filter(file => !file.path.endsWith('/cleanup.sh'))) {
    assert.deepEqual(corrected.files.find(other => other.path === file.path), file, 'Cleanup revision must not change source/toolchain/browser checks');
  }
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-default-tag-'));
try {
  const bin = path.join(root, 'bin'), helper = path.join(root, 'cleanup.sh'), state = path.join(root, 'state.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2),filename=process.env.STATE;
const state=JSON.parse(fs.readFileSync(filename,'utf8'));state.calls.push(args);
const save=()=>fs.writeFileSync(filename,JSON.stringify(state));save();
if(process.env.MODE==='offline')process.exit(1);
if(args.includes('ls')){
 if(args[0]!=='image')process.exit(0);
 const reference=args[args.indexOf('--filter')+1].slice('reference='.length);
 const digest=args.includes('--digests');
 // Docker returns repo:latest for an untagged reference, never the raw input.
 for(const name of state.images){
  if(digest ? name.split('@')[0]===reference : name===reference || name===reference+':latest')console.log(name);
 }
 process.exit(0);
}
if(args[0]==='image'&&args[1]==='rm'){
 if(process.env.MODE==='remove-failed')process.exit(1);
 state.images=state.images.filter(name=>name!==args[2]);save();process.exit(0);
}
process.exit(0);
`, {mode: 0o755});
  function run(profile, reference, expected, mode = 'present', primary = null) {
    const recipe = recipes.generate(logo, profile);
    fs.writeFileSync(helper, recipe.files.find(file => file.path.endsWith('/cleanup.sh')).content);
    const foreign = ['wizard-check-1-2-browser-image:keep', 'unrelated-browser:latest'];
    fs.writeFileSync(state, JSON.stringify({images: mode === 'absent' ? foreign : [expected, ...foreign], calls: []}));
    const command = primary === null ? '. "$1"; cleanup_resource image "$REF"' :
      '. "$1"; builder=wizard-build-1-2; browser_image="$REF"; trap wizard_on_exit EXIT; exit "$PRIMARY"';
    const result = spawnSync('sh', ['-c', command, '--', helper], {cwd: root, encoding: 'utf8', timeout: 10000,
      env: {...process.env, PATH: bin + ':' + process.env.PATH, STATE: state, REF: reference, MODE: mode, PRIMARY: String(primary)}});
    assert(!result.error, result.error?.message);
    return {result, ...JSON.parse(fs.readFileSync(state, 'utf8')), foreign};
  }
  const refs = [
    ['wizard-check-1-2-browser-image', 'wizard-check-1-2-browser-image:latest'],
    ['team/browser', 'team/browser:latest'],
    ['registry.localhost:5050/team/browser', 'registry.localhost:5050/team/browser:latest'],
    ['registry.localhost:5050/team/browser:job-12', 'registry.localhost:5050/team/browser:job-12'],
    ['browser:custom', 'browser:custom'],
    ['registry.localhost:5050/team/browser@sha256:' + 'a'.repeat(64), 'registry.localhost:5050/team/browser@sha256:' + 'a'.repeat(64)]
  ];
  for (const profile of ['legacy-cleanup-v2', 'node24-vite8-cleanup-v2']) {
    for (const [reference, expected] of refs) {
      const outcome = run(profile, reference, expected);
      assert.equal(outcome.result.status, 0, outcome.result.stderr);
      assert.deepEqual(outcome.images, outcome.foreign, 'Owned default tag must be removed and unrelated tags retained');
      assert.deepEqual(outcome.calls.filter(args => args[0] === 'image' && args[1] === 'rm'), [['image', 'rm', expected]]);
      assert(outcome.calls.every(args => !args.includes('prune') && !args.includes('--force') && !args.includes('-f')));
    }
    const [reference, expected] = refs[0];
    const absent = run(profile, reference, expected, 'absent');
    assert.equal(absent.result.status, 0);
    assert(!absent.calls.some(args => args[0] === 'image' && args[1] === 'rm'));
    for (const mode of ['offline', 'remove-failed']) {
      assert.notEqual(run(profile, reference, expected, mode).result.status, 0);
      const failed = run(profile, reference, expected, mode, 0);
      assert.equal(failed.result.status, 1);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'cleanup.json'))).status, 'failed');
      assert.equal(run(profile, reference, expected, mode, 7).result.status, 7, 'Cleanup must preserve the primary job failure');
    }
    const passed = run(profile, reference, expected, 'present', 0);
    assert.equal(passed.result.status, 0, passed.result.stderr);
    assert.deepEqual(passed.images, passed.foreign);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'cleanup.json'))).status, 'passed');
  }
  console.log('Default image tags, registry ports, exact digest/tag removal, failure reporting and historical recipe hashes passed for both cleanup-v2 profiles.');
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
