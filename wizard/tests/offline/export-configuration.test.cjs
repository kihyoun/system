const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const JSZip = require('jszip');
const logo = fs.readFileSync('src/api/Helper.tsx', 'utf8').match(/return `([\s\S]*?)`;/)[1];
const cli = path.resolve('build-tools/export-configuration.cjs');

test('offline adapter executes actual Wizard models and writes a signed private backup without browser or network', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-config-export-'));
  try {
    const input = path.join(root, 'input.json'), output = path.join(root, 'bootstrapper.zip');
    fs.writeFileSync(input, JSON.stringify({main: {data: logo + "\nSEED_DIR='/mnt/seed'\nGITLAB_RUNNER_SCALE='0'\nWIZARD_IMAGE='registry.example.test/ui@sha256:" + 'a'.repeat(64) + "'\n"}, projects: []}));
    const result = spawnSync(process.execPath, [cli, input, output], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Wizard configuration ZIP written.\n');
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    const env = await zip.file('.docker.env').async('string');
    assert.equal(env[807], '$');
    assert.equal(crypto.createHash('md5').update(env.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
    const json = JSON.parse(await zip.file('bootstrapper.json').async('string'));
    assert.equal(json.main.gitlabRunnerScale, 0);
    const recovery = JSON.parse(await zip.file('recovery.json').async('string'));
    assert.deepEqual(json.recovery, recovery);
    assert.equal(recovery.observedRuntime.status, 'unavailable');
    assert.equal(recovery.seed.verified, false);
    assert.equal(recovery.savedImages.wizard.reference, 'registry.example.test/ui@sha256:' + 'a'.repeat(64));
    assert.match(await zip.file('RECOVERY.md').async('string'), /matching completed Seed/);
    assert.equal(json.main.runtimeOptions.WIZARD_IMAGE, 'registry.example.test/ui@sha256:' + 'a'.repeat(64));
    const second = spawnSync(process.execPath, [cli, input, output], {encoding: 'utf8'});
    assert.equal(second.status, 1, 'Existing backups must not be overwritten');
    assert.equal(second.stderr, 'Wizard configuration export failed.\n');
    assert.equal(second.stdout, '');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

 test('offline Fetch adapter carries supplied authenticated observation without confusing it with saved settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-config-observation-'));
  try {
    const observation = {format: 'system-runtime-observation-v1', observedAt: '2026-01-01T00:00:00.000Z',
      status: 'partial', system: {sourceRevision: 'b'.repeat(40), release: null}, wizard: null, images: {}};
    const input = path.join(root, 'fetch.json'), output = path.join(root, 'backup.zip');
    fs.writeFileSync(input, JSON.stringify({main: {data: logo + "\nBOOTSTRAPPER_IMAGE='example/saved:tag'\n", recoveryObservation: observation}, projects: []}));
    const result = spawnSync(process.execPath, [cli, input, output], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    const metadata = JSON.parse(await zip.file('recovery.json').async('string'));
    assert.deepEqual(metadata.observedRuntime, observation);
    assert.equal(metadata.savedImages.controller.reference, 'example/saved:tag');
    assert.equal(metadata.seed.manifest, null);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('coordinated export binds completed generation to exact ENV bytes through ordinary ZIP exporter', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wizard-paired-export-'));
  try {
    const main=logo+"\nGITLAB_IMAGE='gitlab/test:1'\n# retain exact spacing\n";
    const project=logo+"\nPROJECT_NAME='demo'\nPROJECT_KEY='demo'\n";
    const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
    const association={format:'system-backup-pair-v1',status:'matched-completed-seed',verified:true,operation:'a'.repeat(32),generation:'new',
      manifest:'snapshots/new/manifest.json',manifestSha256:'b'.repeat(64),completedAt:'2026-01-01T00:00:00Z',capturedAt:'2026-01-01T00:00:00Z',
      configurationFiles:[{filename:'.docker.env',sha256:digest(main)},{filename:'.projects.env/.demo.env',sha256:digest(project)}]};
    const input=path.join(root,'input.json'),output=path.join(root,'backup.zip');
    const previewSetup={version:1,namespace:'team',wizard:{mode:'import',project:'wizard-source',origin:'https://github.com/example/wizard.git'},
      review:{enabled:true,host:'review.example.test',ssl:'/ssl/review/fullchain.pem',sslKey:'/ssl/review/privkey.pem'},beta:{enabled:false,host:'',ssl:'',sslKey:''}};
    fs.writeFileSync(input,JSON.stringify({main:{data:main},projects:[{filename:'.demo.env',data:project}],seedAssociation:association,previewSetup}));
    const result=spawnSync(process.execPath,[cli,input,output],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const zip=await JSZip.loadAsync(fs.readFileSync(output));
    assert.equal(await zip.file('.docker.env').async('string'),main);
    assert.equal(await zip.file('.projects.env/.demo.env').async('string'),project);
    const metadata=JSON.parse(await zip.file('recovery.json').async('string'));
    assert.deepEqual(metadata.seed,association);
    assert.deepEqual(JSON.parse(await zip.file('bootstrapper.json').async('string')).previewSetup,previewSetup);
    assert.deepEqual(JSON.parse(await zip.file('bootstrapper.json').async('string')).recovery,metadata);
    assert.deepEqual(Object.keys(zip.files).sort(), ['.docker.env', '.projects.env/', '.projects.env/.demo.env', 'RECOVERY.md', 'bootstrapper.json', 'recovery.json'].sort());
    association.configurationFiles[0].sha256='c'.repeat(64);
    fs.writeFileSync(input,JSON.stringify({main:{data:main},projects:[{filename:'.demo.env',data:project}],seedAssociation:association}));
    assert.equal(spawnSync(process.execPath,[cli,input,path.join(root,'rejected.zip')]).status,1);
    assert.equal(fs.existsSync(path.join(root,'rejected.zip')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
