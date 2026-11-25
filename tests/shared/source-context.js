'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const {publicPackagePayload} = require('../../dist/common/publicPayload');
const {pack} = require('../../dist/modules/source-preparation/wizardSource.service');
const {CommittedContextService} = require('../../dist/modules/ci/committedContext.service');
const {NativeContextProcess} = require('../../dist/modules/ci/contextProcess');
const {WizardSourceService} = require('../../dist/modules/source-preparation/wizardSource.service');
const committedContext = new CommittedContextService(new NativeContextProcess(), new WizardSourceService());
const {ContextPreparationService} = require('../../dist/modules/ci/contextPreparation.service');
const {CodeqlContextService} = require('../../dist/modules/ci/codeqlContext.service');
const {WizardBrowserContextService} = require('../../dist/modules/ci/wizardBrowserContext.service');
const preparation = new ContextPreparationService(committedContext);
const prepareContext = root => preparation.prepareContext(root);
const prepareCandidate = root => preparation.prepareCandidate(root);
const prepareCodeql = root => new CodeqlContextService(committedContext).prepare(root);
const prepareWizardBrowser = root => new WizardBrowserContextService(committedContext).prepareWizardBrowser(root);
const root = fs.mkdtempSync(path.join(os.tmpdir(),'committed-test-context-'));
const source = path.resolve(__dirname,'../..');
const gitSelectors = {SYSTEM_SOURCE_GIT_DIR:process.env.SYSTEM_SOURCE_GIT_DIR,WIZARD_SOURCE_GIT_DIR:process.env.WIZARD_SOURCE_GIT_DIR};
delete process.env.SYSTEM_SOURCE_GIT_DIR; delete process.env.WIZARD_SOURCE_GIT_DIR;
const git = (...args) => execFileSync('git',['-C',root,...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
const write = (name,content) => { const file=path.join(root,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content); };
try {
  git('init'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
  const sourceSnapshot = JSON.parse(fs.readFileSync(path.join(source,'assets/wizard-source/snapshot.json'),'utf8'));
  // Real, independent Git objects are required to prove snapshot provenance.
  write('wizard/package.json','{}\n');
  for (const name of ['package-lock.json', 'playwright.config.ts', 'tests/browser/public.spec.ts']) write('wizard/'+name, 'committed browser input\n');
  const runtimeNames = ['project-ci.cjs', 'LICENSES.txt'];
  for (const name of runtimeNames) write('wizard/.system-bootstrapper/build-v2/runtime/'+name, fs.readFileSync(path.join(source, 'templates/project-bootstrap/wizard-build/typed-v6/runtime', name)));
  write('wizard/src/api/Helper.tsx',Buffer.from(sourceSnapshot.files.find(file=>file.path==='src/api/Helper.tsx').content,'base64'));
  for (const name of ['project-ci.cjs','LICENSES.txt']) write('wizard/.gitlab/runtime/'+name,fs.readFileSync(path.join(source,'templates/project-bootstrap/wizard-build/typed-v6/runtime',name)));
  write('wizard/.gitlab/producer-v2.json',JSON.stringify({version:2,runtime:'.gitlab/runtime/project-ci.cjs',runtimeSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'templates/project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs'))).digest('hex'),buildProfile:'node24-vite8-typed-v6'}));
  write('wizard/.gitlab/primary.yml','historical native source fixture\n');
  write('wizard/.env', 'committed-private-wizard-marker\n');
  write('wizard/credentials.json', 'committed-private-wizard-marker\n');
  write('wizard/private.pem', 'committed-private-wizard-marker\n');
  write('wizard/.gitlab-ci.yml','stages: [test]\n');
  write('wizard/start.sh','#!/bin/sh\nexit 0\n');
  write('wizard/public/fixture.bin', Buffer.from([0,255,128,13,10]));
  write('wizard/.system-bootstrapper/build-v1/smoke/check.js','public historical build check\n');
  const wizardGit = (...args) => execFileSync('git',['-C',path.join(root,'wizard'),...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
  wizardGit('init'); wizardGit('config','user.name','Fixture'); wizardGit('config','user.email','fixture@example.invalid');
  wizardGit('add','.'); wizardGit('update-index','--chmod=+x','start.sh'); wizardGit('commit','-m','Committed Wizard fixture');
  const wizardRevision=wizardGit('rev-parse','HEAD');
  write('tests/Dockerfile','FROM scratch\n');
  write('tests/e2e/acme-host-runtime.js','committed native ACME transport\n');
  write('src/modules/ci/codeql.service.ts', 'public scanner service fixture\n');
  for (const name of ['Dockerfile', 'check-sarif.js']) write('tests/codeql/' + name, 'public scanner fixture\n');
  write('.gitlab-ci.yml','stages: [test]\n');
  write('VERSION','1.1.0\n');
  write('README.md','# Committed public package guide\n');
  write('containers/controller/Dockerfile','FROM scratch\n');
  write('package.json','{}\n');
  write('src/api/public.ts','committed source\n');
  write('src/api/config/configuration.module.ts','committed feature module\n');
  write('tests/fixture.sh','#!/bin/sh\nexit 0\n');
  const binary=Buffer.from([0,255,128,13,10]);
  write('tests/binary.png',binary);
  write('config/system/.docker.env.example','public example\n');
  // Use real authored entry and provider names to prove the full Root runtime
  // closure survives context filtering after the native source migration.
  const nativeInputs = [
    'src/cli/main.ts', 'src/cli/applicationCommands.ts', 'src/cli/verifyCa.mts',
    'src/common/caPolicy.mts', 'src/common/runtime/process.ts',
    'src/modules/host-bootstrap/entry.ts', 'src/modules/host-bootstrap/initialize.service.ts',
    'src/modules/host-bootstrap/buildTools.service.ts', 'src/modules/host-bootstrap/certificate.service.ts',
    'src/modules/host-bootstrap/local.service.ts', 'src/modules/host-bootstrap/recovery.service.ts',
    'src/modules/host-bootstrap/runtimeVerification.service.ts',
    'src/modules/storage/entry.ts', 'src/modules/storage/manifestEntry.ts',
    'src/modules/storage/manifest.ts', 'src/modules/storage/storage.service.ts',
    'src/modules/storage/coordinatedBackup.ts', 'src/modules/storage/persistence.ts',
    'src/modules/lifecycle/entry.ts', 'src/modules/lifecycle/lifecycle.service.ts',
    'src/modules/lifecycle/sourceInstallationEntry.ts', 'src/modules/lifecycle/publicSettingsEntry.ts',
    'src/modules/wizard-recovery/wizardRecovery.service.ts'];
  const runtimeInputs = [...nativeInputs, 'tools/quickstart/quickstart.sh', 'tools/gitlab/bootstrap-token.rb',
    'containers/bootstrapper/Dockerfile', 'config/gitlab/docker-compose.omnibus.yml', 'config/gitlab-runner/docker-compose.yml',
    'config/system/.seed.env', 'config/system/docker-compose.yml', 'src/modules/projects-routing/wizardAliases.ts'];
  const browserInputs = [...new Set(['tests/wizard-browser.Dockerfile', '.prettierrc', '.prettierignore', 'LICENSE',
    ...publicPackagePayload.filter(name => !name.startsWith('wizard/')),
    'src/common/publicPayload.ts',
    'src/modules/project-ci/cliArtifact.ts', 'package.json', 'package-lock.json', 'tsconfig.json',
    ...['configuration.module.ts', 'configuration.service.ts', 'entry.ts'].map(name => 'src/modules/configuration/'+name),
    'src/modules/mirror/credentials.service.ts', 'config/ca/cacert-2026-10-20.crt', 'config/ca/provenance.json',
    ...runtimeNames.map(name => 'templates/project-bootstrap/wizard-build/typed-v6/runtime/'+name)])];
  const fixtureTrust = 'tests/e2e/acme-fixture/pebble.minica.pem';
  const fixtureTrustBytes = fs.readFileSync(path.join(source, fixtureTrust));
  write(fixtureTrust, fixtureTrustBytes);
  const committedInputs = new Map([...runtimeInputs, ...browserInputs].map(name => [name, fs.readFileSync(path.join(source, name))]));
  for (const [name, content] of committedInputs) write(name, content);
  const privateInputs = ['templates/project-bootstrap/private.env', 'src/modules/mirror/credentials.json',
    'src/operator-private.pem', 'config/bootstrapper.zip',
    'config/credentials.js', 'config/system/.env', 'tests/credentials.json', 'tests/e2e/acme-fixture/operator.pem', 'tests/e2e/acme-fixture/pebble.minica.key'];
  for (const name of privateInputs) write(name, 'committed-private-marker\n');
  write('templates/project-bootstrap/private.env','must not enter the context\n');
  git('add','.'); git('update-index','--chmod=+x','tests/fixture.sh');
  git('update-index','--add','--cacheinfo','160000,'+wizardRevision+',wizard');
  git('commit','-m','Source fixture');
  const snapshot=pack(root);
  write(fixtureTrust, 'dirty-private-trust-marker');
  write('wizard/.gitlab/runtime/project-ci.cjs', 'dirty-private-wizard-marker');
  write('wizard/.gitlab/producer-v2.json', 'dirty-private-wizard-marker');
  write('wizard/untracked-secret.ts', 'untracked-private-wizard-marker');
  for (const name of ['.docker.env','config/system/.docker.env','tests/credentials.json','templates/project-bootstrap/untracked-secret.txt','seed/data','test-results/old.xml']) write(name,'untracked-private-marker');
  write('src/api/public.ts','dirty-private-marker');
  for (const name of ['src/modules/host-bootstrap/entry.ts', 'src/modules/mirror/credentials.service.ts', 'LICENSE', 'src/modules/project-ci/cliArtifact.ts']) write(name, 'dirty-private-marker');
  fs.symlinkSync('credentials.json', path.join(root, 'src/modules/mirror/untracked-link.ts'));
  write('.gitlab-ci.yml','dirty-uncommitted-ci\n');
  write('VERSION','9.9.9\n');
  write('README.md','dirty-private-guide-marker\n');
  write('assets/wizard-source/snapshot.json',JSON.stringify({...snapshot,unrecognizedSecret:'never copy this metadata'}));
  const result = prepareContext(root);
  const archive=path.join(root,'.test-context/context.tar');
  assert(!result.files.some(name=>/untracked-secret|untracked-link|seed\/data|old\.xml/.test(name)));
  for (const name of privateInputs) assert(!result.files.includes(name), 'Excluded private input: '+name);
  assert(result.files.includes('config/system/.docker.env.example'));
  assert(result.files.includes('README.md'), 'Public npm metadata is required by the isolated package contract');
  assert.equal(execFileSync('tar',['-xOf',archive,'README.md'],{encoding:'utf8'}),'# Committed public package guide\n', 'Package guide comes from committed source');
  assert(result.files.includes('containers/controller/Dockerfile'), 'Runtime pin extraction needs the committed Dockerfile');
  assert(execFileSync('tar',['-xOf',archive,'containers/controller/Dockerfile']).equals(committedInputs.get('containers/controller/Dockerfile')));
  assert.equal(execFileSync('tar',['-xOf',archive,'.gitlab-ci.yml'],{encoding:'utf8'}),'stages: [test]\n');
  assert.equal(execFileSync('tar',['-xOf',archive,'VERSION'],{encoding:'utf8'}),'1.1.0\n', 'Release verification uses the committed version, not working-copy edits');
  for(const filename of runtimeInputs) assert(result.files.includes(filename), 'Missing runtime input: '+filename);
  for (const [name, content] of committedInputs) {
    assert(result.files.includes(name), 'Missing native build/runtime input: '+name);
    assert(execFileSync('tar', ['-xOf', archive, name], {maxBuffer:8*1024*1024}).equals(content), 'Preserve committed native input bytes: '+name);
  }
  assert.equal(execFileSync('tar',['-xOf',archive,'src/api/public.ts'],{encoding:'utf8'}),'committed source\n');
  assert(execFileSync('tar',['-xOf',archive,'tests/binary.png']).equals(binary),'preserve binary source bytes');
  const cleanSnapshot = JSON.parse(execFileSync('tar',['-xOf',archive,'assets/wizard-source/snapshot.json'],{encoding:'utf8',maxBuffer:8*1024*1024}));
  assert(!Object.hasOwn(cleanSnapshot,'unrecognizedSecret'));
  assert(execFileSync('tar', ['-tvf', archive, 'wizard/start.sh'], {encoding:'utf8'}).includes('rwxr-xr-x'), 'Isolated Wizard preserves executable snapshot modes');
  assert.deepEqual(result.files.filter(name=>name.startsWith('wizard/')).sort(), snapshot.files.map(file=>'wizard/'+file.path).sort(), 'Isolated Wizard source is exactly the validated snapshot');
  for (const file of snapshot.files) {
    assert(execFileSync('tar', ['-xOf', archive, 'wizard/'+file.path], {maxBuffer:8*1024*1024}).equals(Buffer.from(file.content,'base64')), 'Isolated Wizard byte closure: '+file.path);
  }
  assert(!result.files.some(name=>/^wizard\/(?:\.env|credentials\.json|private\.pem|untracked-secret\.ts|\.git\/|\.system-bootstrapper\/build-v[12]\/)/.test(name)), 'Wizard private, untracked and reserved recipe paths stay excluded');
  assert(execFileSync('tar', ['-xOf', archive, fixtureTrust]).equals(fixtureTrustBytes), 'Use only the committed public ACME fixture trust');
  assert.equal(crypto.createHash('sha256').update(fixtureTrustBytes).digest('hex'), '0c502e52627ff7de972c7e9e065640103b4589b4e2d23d3fcf21bef1e3c8c67c');
  const isolatedDockerfile = fs.readFileSync(path.join(source,'tests/Dockerfile'),'utf8');
  assert.match(isolatedDockerfile, /^WORKDIR \/candidate$/m, 'The isolated image builds in the staged candidate root');
  assert.match(isolatedDockerfile, /^COPY \. \.$/m, 'The isolated image copies the complete verified context, including its exact staged Wizard snapshot');
  const mode = execFileSync('tar',['-tvf',archive,'tests/fixture.sh'],{encoding:'utf8'});
  assert(mode.includes('rwxr-xr-x'),'preserve executable mode');
  assert.equal(fs.readFileSync(path.join(root,'.test-context/revision'),'utf8').trim(),git('rev-parse','HEAD'));
  const candidate=prepareCandidate(root);
  assert(candidate.files.includes('containers/controller/Dockerfile'));
  for (const name of runtimeInputs.filter(name=>name.startsWith('tools/'))) assert(candidate.files.includes(name), 'Missing candidate bootstrap adapter: '+name);
  assert(candidate.files.includes('wizard/start.sh'));
  assert.deepEqual(candidate.files.filter(name=>name.startsWith('tests/')),['tests/e2e/acme-host-runtime.js']);
  assert.equal(execFileSync('tar',['-xOf',path.join(root,'.candidate-context/context.tar'),'tests/e2e/acme-host-runtime.js'],{encoding:'utf8'}),'committed native ACME transport\n');
  for (const name of privateInputs) assert(!candidate.files.includes(name), 'Excluded candidate private input: '+name);
  for (const name of [...runtimeInputs, ...browserInputs.filter(name=>name.startsWith('src/modules/'))]) assert(candidate.files.includes(name), 'Missing candidate runtime input: '+name);
  assert.equal(execFileSync('tar',['-xOf',path.join(root,'.candidate-context/context.tar'),'src/api/public.ts'],{encoding:'utf8'}),'committed source\n');
  assert.equal(execFileSync('tar',['-xOf',path.join(root,'.candidate-context/context.tar'),'src/api/config/configuration.module.ts'],{encoding:'utf8'}),'committed feature module\n');
  assert.equal(candidate.wizardRevision,snapshot.sourceRevision);
  const staticContext = prepareCodeql(root);
  const staticArchive = path.join(root, '.codeql-context/context.tar');
  for (const name of publicPackagePayload) {
    const expected = name.startsWith('wizard/') ? Buffer.from(snapshot.files.find(file=>file.path===name.slice(7)).content,'base64') : committedInputs.get(name);
    assert(execFileSync('tar',['-xOf',staticArchive,'tooling/'+name],{maxBuffer:8*1024*1024}).equals(expected), 'Native CodeQL tooling preserves its committed public package dependency: '+name);
  }
  assert(execFileSync('tar', ['-xOf', staticArchive, 'source/'+fixtureTrust]).equals(fixtureTrustBytes), 'Static context preserves the exact public fixture certificate');
  assert.equal(execFileSync('tar', ['-xOf', staticArchive, 'source/src/api/public.ts'], {encoding:'utf8'}), 'committed source\n');
  assert(staticContext.files.includes('tests/fixture.sh'), 'Static analysis includes committed test sources');
  assert(staticContext.files.includes('wizard/src/api/Helper.tsx'), 'Static analysis includes the exact Wizard pin');
  assert(staticContext.files.includes('wizard/.system-bootstrapper/build-v1/smoke/check.js'), 'Static analysis retains historical committed build recipes omitted from deployment snapshots');
  for (const name of privateInputs) assert(!staticContext.files.includes(name), 'Excluded static private input: '+name);
  for (const name of [...runtimeInputs, ...browserInputs.filter(name=>name.startsWith('src/modules/'))]) assert(staticContext.files.includes(name), 'Missing static native input: '+name);
  const browser = prepareWizardBrowser(root);
  const browserArchive = path.join(root, '.wizard-browser-context/context.tar');
  for (const name of browserInputs) {
    assert(browser.files.includes(name), 'Missing browser build input: '+name);
    assert(execFileSync('tar', ['-xOf', browserArchive, name], {maxBuffer:8*1024*1024}).equals(committedInputs.get(name)), 'Preserve browser committed input bytes: '+name);
  }
  for (const name of runtimeNames) assert(browser.files.includes('wizard/.system-bootstrapper/build-v2/runtime/'+name), 'Browser generator verifies the committed managed runtime');
  for (const name of privateInputs) assert(!browser.files.includes(name), 'Excluded browser private input: '+name);
  assert(!browser.files.includes('src/modules/mirror/untracked-link.ts'));
  assert(!snapshot.files.some(file => file.path.startsWith('.system-bootstrapper/build-v2/')), 'Deployment snapshot retains its recipe exclusion');
  const forged=JSON.parse(JSON.stringify(snapshot));
  const changed=forged.files.find(file=>file.path==='start.sh');
  changed.content=Buffer.from('#!/bin/sh\necho uncommitted-snapshot-injection\n').toString('base64');
  changed.sha256=crypto.createHash('sha256').update(Buffer.from(changed.content,'base64')).digest('hex');
  const manifest={version:forged.version,sourceRevision:forged.sourceRevision,files:forged.files.map(({path,mode,sha256})=>({path,mode,sha256}))};
  forged.manifestHash=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  write('assets/wizard-source/snapshot.json',JSON.stringify(forged));
  assert.throws(()=>prepareContext(root),/differs from committed source/);
  assert.throws(()=>prepareCandidate(root),/differs from committed source/);
  assert.throws(()=>prepareCodeql(root),/differs from committed source/);
  assert.throws(()=>prepareWizardBrowser(root),/differs from committed source/);
  write('assets/wizard-source/snapshot.json',JSON.stringify(snapshot));
  // Dirty Wizard worktree source is ignored: only pinned blobs define provenance.
  write('wizard/start.sh','dirty-worktree-marker\n');
  prepareContext(root); prepareCandidate(root);
  const stale = {...snapshot,sourceRevision:'0'.repeat(40)};
  write('assets/wizard-source/snapshot.json',JSON.stringify(stale));
  assert.throws(()=>prepareContext(root),/stale|manifest hash/);
  assert.throws(()=>prepareCandidate(root),/snapshot|manifest hash/);
  write('assets/wizard-source/snapshot.json',JSON.stringify(snapshot));
  write('src/modules/mirror/credentials.local.ts', 'private data cannot masquerade as authored source\n');
  git('add', 'src/modules/mirror/credentials.local.ts'); git('commit', '-m', 'Reject ambiguous operations source');
  for (const prepare of [prepareContext, prepareCandidate, prepareCodeql, prepareWizardBrowser])
    assert.throws(() => prepare(root), /source path conflicts with a private-data exclusion/);
  git('rm', 'src/modules/mirror/credentials.local.ts'); git('commit', '-m', 'Remove ambiguous operations source');
  write('src/api/credentials.local.ts','reserved-directory source\n');
  git('add','src/api/credentials.local.ts');
  git('commit','-m','Source path conflicts with private data exclusion');
  assert.throws(()=>prepareCandidate(root),/source path conflicts with a private-data exclusion/);
  git('rm','src/api/credentials.local.ts');
  git('commit','-m','Remove conflicting source path');
  prepareCandidate(root);
  // The new Wizard is a regular source tree with a static NGINX image. Only
  // historical gitlinks need start.sh; current candidates must carry their
  // actual Docker build and web-server inputs instead.
  git('rm','--cached','wizard');
  fs.rmSync(path.join(root,'wizard/.git'),{recursive:true,force:true});
  fs.rmSync(path.join(root,'wizard/start.sh'));
  for(const name of ['Dockerfile','nginx/nginx.conf','package-lock.json'])write('wizard/'+name,'committed monorepo input\n');
  fs.rmSync(path.join(root, 'src/modules/mirror/untracked-link.ts'));
  git('add','wizard');git('commit','-m','Integrate static Wizard source tree');
  write('assets/wizard-source/snapshot.json',JSON.stringify(pack(root)));
  const monorepo=prepareCandidate(root);
  assert.equal(monorepo.sourceLayout,'system-monorepo-v1');
  assert(!monorepo.files.includes('wizard/start.sh'));
  for(const name of ['Dockerfile','nginx/nginx.conf','package.json','package-lock.json'])assert(monorepo.files.includes('wizard/'+name));
  git('rm','wizard/nginx/nginx.conf');git('commit','-m','Remove required current Wizard runtime input');
  write('assets/wizard-source/snapshot.json',JSON.stringify(pack(root)));
  assert.throws(()=>prepareCandidate(root),/Incomplete full-System candidate source/);
  write('wizard/nginx/nginx.conf','committed monorepo input\n');git('add','wizard/nginx/nginx.conf');git('commit','-m','Restore current Wizard runtime input');
  write('assets/wizard-source/snapshot.json',JSON.stringify(pack(root)));
  prepareCandidate(root);
  const trustBlob = git('rev-parse', 'HEAD:'+fixtureTrust);
  git('update-index', '--cacheinfo', '120000,'+trustBlob+','+fixtureTrust); git('commit', '-m', 'Reject fixture certificate links');
  write('assets/wizard-source/snapshot.json',JSON.stringify(pack(root)));
  assert.throws(()=>prepareContext(root),/links and nested submodules/);
  assert.throws(()=>prepareCodeql(root),/links and nested submodules/);
  git('update-index', '--cacheinfo', '100644,'+trustBlob+','+fixtureTrust); git('commit', '-m', 'Restore public fixture certificate');
  git('update-index','--add','--cacheinfo','120000,'+git('hash-object','package.json')+',tests/unsafe-link');
  git('commit','-m','Reject links');
  write('assets/wizard-source/snapshot.json',JSON.stringify(pack(root)));
  assert.throws(()=>prepareContext(root),/links and nested submodules/);
  assert.throws(()=>prepareCodeql(root),/links and nested submodules/);
  const serviceBlob = git('rev-parse', 'HEAD:src/modules/mirror/credentials.service.ts');
  git('update-index', '--cacheinfo', '120000,'+serviceBlob+',src/modules/mirror/credentials.service.ts');
  git('commit', '-m', 'Reject authored source links');
  write('assets/wizard-source/snapshot.json',JSON.stringify(pack(root)));
  assert.throws(()=>prepareCandidate(root),/links and nested submodules/);
  assert.throws(()=>prepareWizardBrowser(root),/committed regular file/);
  console.log('PASS: committed-only context, ignored/private/dirty exclusions, verified snapshot, executable bytes, stale snapshot and link refusal.');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
  for(const [key,value]of Object.entries(gitSelectors)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
