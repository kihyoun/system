'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync, spawnSync} = require('node:child_process');
const {RecoveryManifestService, canonicalDigest, canonicalSelector, fileSha} = require('../../dist/modules/host/recovery-manifest');
const {runtimeImageSelectors, verifyImageInspections} = require('../../dist/modules/host/runtime-inspection');
const service = new RecoveryManifestService(), root = path.resolve(__dirname, '../..');
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'system-native-init-'));
  const checkout = path.join(directory, 'checkout'), retained = path.join(directory, 'recovery');
  fs.mkdirSync(checkout); fs.mkdirSync(path.join(retained, 'images'), {recursive:true});
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q'); fs.writeFileSync(path.join(checkout,'tracked'),'source\n'); git('add','tracked');
  const wizard = 'b'.repeat(40), image = 'sha256:'+'a'.repeat(64);
  git('update-index','--add','--cacheinfo','160000,'+wizard+',wizard');
  const commit = () => git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'); commit();
  const archive = path.join(retained,'images/controller.tar.gz'); fs.writeFileSync(archive,'declared test archive');
  const sourceCommit = git('rev-parse','HEAD'), sourceTree = git('rev-parse','HEAD^{tree}');
  const manifest = {sourceCommit,sourceTree,wizardSourceRevision:wizard,
    archives:[{file:'images/controller.tar.gz',sha256:fileSha(archive),imageId:image,sourceCommit,sourceTree,wizardSourceRevision:wizard}],
    publicImages:[{reference:'nginx@sha256:'+'c'.repeat(64),tag:'nginx:retained',imageId:'sha256:'+'c'.repeat(64)}],
    localImages:[{tag:'system_bootstrapper',imageId:image},{tag:'controller:retained',imageId:image}],
    currentController:{reference:'controller:retained',imageId:image,sourceCommit,sourceTree}};
  const filename = path.join(retained,'images.json');
  const save = () => fs.writeFileSync(filename,JSON.stringify(manifest)); save();
  return {directory,checkout,retained,git,commit,archive,manifest,filename,image,save,
    verify: (...args) => service.load(retained,checkout,...args),
    close: () => fs.rmSync(directory,{recursive:true,force:true})};
}
function using(fn) {const f=fixture();try{fn(f);}finally{f.close();}}
test('retained manifest binds archive bytes, immutable source and declared image aliases',()=>{
  using(f=>{
    fs.writeFileSync(path.join(f.checkout,'tracked'),'new reviewed tool\n'); f.git('add','tracked');f.commit();
    assert.equal(f.verify().sourceCommit,f.manifest.sourceCommit);
    assert.throws(()=>f.verify('f'.repeat(64)),/manifest-checksum-mismatch/);
    fs.writeFileSync(f.archive,'corrupt payload'); assert.throws(()=>f.verify(),/checksum-mismatch/);
  });
  const cases = [
    [m=>m.archives[0].file='images/../controller.tar.gz',/archive-path/],
    [m=>m.sourceTree='d'.repeat(40),/source-tree-mismatch/],
    [m=>m.wizardSourceRevision='e'.repeat(40),/wizard-gitlink-mismatch/],
    [m=>m.currentController.sourceCommit='f'.repeat(40),/controller-source-mismatch/],
    [m=>m.localImages[1].imageId='sha256:'+'f'.repeat(64),/no-declared-archive/],
    [m=>m.localImages.push({...m.localImages[0]}),/duplicate-image-alias/],
    [m=>m.publicImages[0].reference='nginx:latest',/digest-pinned/],
    [m=>{m.publicImages[0].tag='nginx:latest';m.localImages.push({tag:'nginx',imageId:m.archives[0].imageId});},/duplicate-image-alias/],
  ];
  for(const [change,error] of cases) using(f=>{change(f.manifest);f.save();assert.throws(()=>f.verify(),error);});
  using(f=>{fs.unlinkSync(f.archive);fs.symlinkSync('/dev/null',f.archive);assert.throws(()=>f.verify(),/archive-escapes/);});
  using(f=>{
    for(const key of Object.keys(f.manifest)) if(!['archives','publicImages'].includes(key))delete f.manifest[key];
    f.save(); f.verify(undefined,true); assert.throws(()=>f.verify(),/local-image-aliases-required/);
    const result=spawnSync(process.execPath,[path.join(root,'dist/cli/main.js'),'recovery','load','--checkout',f.checkout,'--directory',f.retained,'--checksums-only'],{encoding:'utf8',timeout:30000,maxBuffer:8192});
    assert.notEqual(result.status,0);assert.match(result.stderr,/legacy-checksums-cannot-load/);
  });
});
test('image normalization preserves repositories, registry ports and explicit tags',()=>{
  const digest='sha256:'+'a'.repeat(64);
  assert.equal(canonicalDigest('registry.example.invalid:5050/group/app:release@'+digest),'registry.example.invalid:5050/group/app@'+digest);
  assert.equal(canonicalDigest('gitlab/gitlab-ce:release@'+digest),'gitlab/gitlab-ce@'+digest);
  assert.notEqual(canonicalDigest('other/repository:release@'+digest),'gitlab/gitlab-ce@'+digest);
  for(const [selected,canonical] of [['nginx','nginx:latest'],['group/nginx','group/nginx:latest'],['registry.example.invalid:5050/group/nginx','registry.example.invalid:5050/group/nginx:latest'],['registry.example.invalid:5050/group/nginx:stable','registry.example.invalid:5050/group/nginx:stable'],['registry.example.invalid:5050/group/nginx@'+digest,'registry.example.invalid:5050/group/nginx@'+digest],['nginx:stable@'+digest,'nginx:stable@'+digest],[digest,digest]])assert.equal(canonicalSelector(selected),canonical);
  assert.notEqual(canonicalSelector('nginx:stable'),canonicalSelector('nginx'));assert.notEqual(canonicalSelector('group/nginx'),canonicalSelector('nginx'));
});
test('saved selectors and running services must match retained image identities without rewriting inputs',()=>{
  using(f=>{
    const config=path.join(f.directory,'settings.env');
    const base='BOOTSTRAPPER_IMAGE=controller:retained\nGITLAB_IMAGE=nginx:retained\nGITLAB_RUNNER_IMAGE=nginx:retained\nWIZARD_ENABLE=false\n';
    fs.writeFileSync(config,base+'NGINX_IMAGE=nginx:retained\n');service.validateSelected(f.manifest,config);
    fs.appendFileSync(config,'GITLAB_IMAGE=unrecorded:latest\n');assert.throws(()=>service.validateSelected(f.manifest,config),/not-declared/);
    f.manifest.publicImages[0].tag='nginx:latest';f.save();
    fs.writeFileSync(config,'BOOTSTRAPPER_IMAGE=controller:retained\nunset NGINX_IMAGE\nGITLAB_IMAGE=nginx:latest\nGITLAB_RUNNER_IMAGE=nginx:latest\nWIZARD_ENABLE=false\n');
    const before=[fs.readFileSync(config),fs.readFileSync(f.filename)];service.validateSelected(f.verify(),config);
    const runtime={BOOTSTRAPPER_IMAGE:'controller:retained',NGINX_IMAGE:'',GITLAB_IMAGE:'nginx:latest',GITLAB_RUNNER_IMAGE:'nginx:latest',GITLAB_RUNNER_SCALE:'1',WIZARD_ENABLE:'false'};
    const publicImage=f.manifest.publicImages[0].imageId;
    const services={system_bootstrapper_1:{Image:f.image},...Object.fromEntries(['system_web_1','system_gitlab_1','runner_docker_1'].map(name=>[name,{Image:publicImage}]))};
    const inspections=Object.fromEntries([...new Set([...Object.values(runtimeImageSelectors(runtime)),runtime.GITLAB_RUNNER_IMAGE])].map(ref=>[ref,{Id:ref==='controller:retained'?f.image:publicImage}]));
    verifyImageInspections(runtime,f.manifest,services,inspections);
    assert.deepEqual([fs.readFileSync(config),fs.readFileSync(f.filename)],before);
    assert.throws(()=>verifyImageInspections(runtime,f.manifest,services,{...inspections,nginx:{Id:'sha256:'+'f'.repeat(64)}}),/image-alias-retargeted/);
    services.system_web_1.Image='sha256:'+'f'.repeat(64);assert.throws(()=>verifyImageInspections(runtime,f.manifest,services,inspections),/service-image-selection-mismatch/);
    f.manifest.publicImages[0].tag='registry.example.invalid:5050/group/nginx:latest';
    const remote='BOOTSTRAPPER_IMAGE=controller:retained\nGITLAB_IMAGE=registry.example.invalid:5050/group/nginx:latest\nGITLAB_RUNNER_IMAGE=registry.example.invalid:5050/group/nginx:latest\nWIZARD_ENABLE=false\n';
    fs.writeFileSync(config,remote+'NGINX_IMAGE=registry.example.invalid:5050/group/nginx\n');service.validateSelected(f.manifest,config);
    for(const selected of ['nginx','registry.example.invalid:5050/group/nginx:stable','registry.example.invalid:5051/group/nginx','registry.example.invalid:5050/other/nginx']) {
      fs.writeFileSync(config,remote+'NGINX_IMAGE='+selected+'\n');assert.throws(()=>service.validateSelected(f.manifest,config),/not-declared/);
    }
  });
});
