'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
test('public tarball carries compiled CLI and offline validation assets without private or checkout files',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrapper-package-'));
  try {
    const [record]=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',temporary],{cwd:root,encoding:'utf8'}));
    const files=record.files.map(file=>file.path);
    assert(!files.includes('assets/project-bootstrap/preview-setup/settings.js'));
    for(const required of ['dist/cli/main.js','dist/index.js','dist/modules/storage/entry.js','dist/modules/project-lifecycle/previewSettings.js','README.md','LICENSE'])assert(files.includes(required),required);
    const {publicPackagePayload}=require('../../dist/common/publicPayload');
    assert.equal(publicPackagePayload.length,110);
    const metadataFiles=new Set(['assets/source.json','assets/public-runtime.json','README.md','LICENSE','package.json','wizard/README.md','wizard/LICENSE']);
    const npmOmissions=new Set(['angular','react','web'].map(template=>'templates/project-bootstrap/templates/'+template+'/.gitignore'));
    const publicFiles=files.filter(file=>!file.startsWith('dist/')&&!file.startsWith('node_modules/')&&!metadataFiles.has(file));
    assert.deepEqual(publicFiles.sort(),publicPackagePayload.filter(file=>!npmOmissions.has(file)).sort());
    // Full source checkouts contain optional Wizard package metadata; verified
    // deployment snapshots deliberately omit these non-runtime documentation files.
    for(const file of ['wizard/README.md','wizard/LICENSE']){
      const source=fs.lstatSync(path.join(root,file),{throwIfNoEntry:false});
      if(source)assert(source.isFile()&&!source.isSymbolicLink(),file);
      assert.equal(files.includes(file),Boolean(source),file);
    }
    assert(!files.includes('config/system/.projects.env'));
    assert(!files.some(file=>/(?:^|\/)(?:\.env|\.npmrc|private)(?:\/|$)/.test(file)));
    const installed=path.join(temporary,'installed'); fs.mkdirSync(installed);
    execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',installed,path.join(temporary,record.filename)],{cwd:temporary,stdio:'pipe',env:{...process.env,npm_config_cache:path.join(temporary,'empty-cache'),npm_config_userconfig:path.join(temporary,'user.npmrc'),npm_config_globalconfig:path.join(temporary,'global.npmrc')}});
    const packageRoot=path.join(installed,'node_modules/@systembootstrapper/cli');
    for(const file of ['wizard/README.md','wizard/LICENSE'])if(files.includes(file))assert(fs.readFileSync(path.join(packageRoot,file)).equals(fs.readFileSync(path.join(root,file))),file);
    for(const file of ['guidedPreviewEvidence.js','guidedPreviewEvidenceV1.js','jobDiagnostics.js','evidenceValues.js'])
      assert(fs.readFileSync(path.join(packageRoot,'dist/modules/release',file)).equals(fs.readFileSync(path.join(root,'dist/modules/release',file))),file);
    const policy=require(path.join(packageRoot,'dist/modules/release/lifecyclePolicy')).lifecyclePolicy();
    assert.equal(typeof policy.validateAuthority,'function');assert(policy.stagesV2.includes('system-beta-native-deploy'));
    const metadata=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json')));
    for(const script of ['preinstall','install','postinstall','prepare'])assert.equal(metadata.scripts[script],undefined);
    assert.equal(metadata.bin['system-bootstrapper'],'dist/cli/main.js');
    const version=execFileSync(process.execPath,[path.join(packageRoot,'dist/cli/main.js'),'--version'],{encoding:'utf8',env:{PATH:'/missing',HOME:temporary}}).trim();
    assert.equal(version,metadata.version);
    const installedCli=path.join(installed,'node_modules/.bin/system-bootstrapper');
    assert.equal(execFileSync(process.execPath,[installedCli,'--version'],{encoding:'utf8'}).trim(),metadata.version);
    const api=require(packageRoot);
    assert.equal(typeof api.StorageModule.register,'function');
    assert.equal(typeof api.StorageService,'function');
    const {publicPayloadFiles}=require(path.join(packageRoot,'dist/common/publicPayload'));
    const runtime=path.join(temporary,'host-runtime'),manifestBytes=fs.readFileSync(path.join(packageRoot,'assets/public-runtime.json'));
    const payload=JSON.parse(manifestBytes);
    for(const template of ['angular','react','web']){
      const prefix='templates/project-bootstrap/templates/'+template,name=prefix+'/.gitignore';
      assert(!fs.existsSync(path.join(packageRoot,name)));
      assert(!fs.existsSync(path.join(packageRoot,prefix,'.npmignore')));
      const selected=publicPayloadFiles(packageRoot,prefix).find(file=>file.path===name);
      assert(selected,'offline installed package retains canonical template '+name);
      assert(selected.content.equals(Buffer.from(payload.files.find(file=>file.path===name).content,'base64')));
    }
    fs.mkdirSync(path.join(runtime,'assets'),{recursive:true});
    fs.writeFileSync(path.join(runtime,'assets/public-runtime.json'),manifestBytes);
    for(const file of payload.files){const destination=path.join(runtime,file.path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,Buffer.from(file.content,'base64'));}
    const privateState=path.join(temporary,'state');fs.mkdirSync(privateState,{mode:0o700});
    const projects=path.join(privateState,'projects.env');fs.writeFileSync(projects,'PROJECTS=retained\n',{mode:0o600});
    fs.symlinkSync(projects,path.join(runtime,'config/system/.projects.env'));
    const prefix='templates/project-bootstrap/templates/react';
    const selected=()=>publicPayloadFiles(runtime,prefix);
    const baseline=selected();assert(baseline.length>0);
    assert(!payload.files.some(file=>file.path==='config/system/.projects.env'),'mutable State link is outside the immutable inventory');
    for(const name of [prefix+'/src/App.tsx','config/ca/cacert-2026-10-20.crt','templates/project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs']){
      const destination=path.join(runtime,name),before=fs.readFileSync(destination);
      fs.appendFileSync(destination,'\nchanged immutable bytes\n');
      assert.throws(selected,/public-payload-file-hash-mismatch/,name);
      fs.writeFileSync(destination,before);assert.deepEqual(selected(),baseline);
    }
    const template=path.join(runtime,prefix,'src/App.tsx'),templateBytes=fs.readFileSync(template),outside=path.join(privateState,'template-copy');
    fs.writeFileSync(outside,templateBytes);fs.unlinkSync(template);fs.symlinkSync(outside,template);
    assert.throws(selected,/public-payload-links-refused/,'an inventoried template link is refused even when its target bytes match');
    fs.unlinkSync(template);fs.writeFileSync(template,templateBytes);assert.deepEqual(selected(),baseline);
    fs.unlinkSync(template);assert.throws(selected,error=>error.code==='ENOENT','ordinary missing payload files never use manifest fallback');
    fs.writeFileSync(template,templateBytes);
    const ignore=path.join(runtime,prefix,'.gitignore'),ignoreBytes=fs.readFileSync(ignore);
    fs.unlinkSync(ignore);assert.deepEqual(selected(),baseline,'the exact npm omission retains canonical bytes');
    fs.symlinkSync(path.join(privateState,'missing-ignore'),ignore);
    assert.throws(selected,/public-payload-links-refused/,'a dangling canonical link is not a missing-file fallback');fs.unlinkSync(ignore);
    const ignoreAlias=path.join(runtime,prefix,'.npmignore');fs.symlinkSync(outside,ignoreAlias);
    assert.throws(selected,/public-payload-links-refused/,'the npm alias must also be a regular inventoried file');fs.unlinkSync(ignoreAlias);
    fs.writeFileSync(ignoreAlias,ignoreBytes);assert.deepEqual(selected(),baseline);
    fs.appendFileSync(ignoreAlias,'\nchanged alias\n');assert.throws(selected,/public-payload-file-hash-mismatch/);fs.unlinkSync(ignoreAlias);
    const templateDirectory=path.join(runtime,prefix),moved=templateDirectory+'-real';
    fs.renameSync(templateDirectory,moved);fs.symlinkSync(moved,templateDirectory,'dir');
    assert.throws(selected,/public-payload-links-refused/,'missing .gitignore does not allow a linked template parent');
    fs.unlinkSync(templateDirectory);fs.renameSync(moved,templateDirectory);fs.writeFileSync(ignore,ignoreBytes);
    assert.deepEqual(selected(),baseline);
    assert.equal(fs.readFileSync(projects,'utf8'),'PROJECTS=retained\n');
    const adapter=require(path.join(packageRoot,'dist/common/runtime/previewSettings.js'));
    assert.equal(adapter.normalizePreview({version:2,namespace:'example',wizard:{mode:'existing',project:'system'},review:{enabled:false,host:'',ssl:'',sslKey:''},beta:{enabled:false,host:'',ssl:'',sslKey:''}}).version,2);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
