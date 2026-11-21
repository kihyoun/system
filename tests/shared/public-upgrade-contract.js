'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {download, prepare, archiveConfigDigest, prepareSource, run, preserved, replaceController, controllerFixture, waitForServices, NativeCLI} = require('../e2e/public-upgrade');
const {preparationFailure} = require('../e2e/prepare-images');
const edge = require('../../config/releases/upgrade-paths.json').transitions.find(row => row.to === fs.readFileSync(path.join(__dirname, '../../VERSION'), 'utf8').trim());
const id = char => 'sha256:' + char.repeat(64);
function fixture() {
  const metadata = {format: 'system-accepted-release-v1', version: edge.from, tag: 'v' + edge.from, platform: 'linux/amd64',
    source: {repository: 'https://github.com/example/system.git', revision: 'a'.repeat(40), tree: 'b'.repeat(40), wizardRevision: 'c'.repeat(40)},
    acceptance: {requiredChecksPassed: true, controllerWizardSameAttempt: true, candidateJobId: 31},
    images: {controller: {reference: 'example/system@' + id('1'), imageId: id('3'), configDigest: id('3')},
      wizard: {reference: 'example/wizard@' + id('2'), imageId: id('4'), configDigest: id('4')}}};
  return metadata;
}
function controllerBaseline() {
  return {Config: {Env: ['PATH=/inherited/bin', 'BOOTSTRAPPER_IMAGE=old-controller', 'WIZARD_IMAGE=old-wizard',
    'SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER=', 'PERSISTENT_DIR=/old-live', 'SEED_DIR=/old-seed',
    'GITLAB_IMAGE=old-gitlab', 'GITLAB_RUNNER_IMAGE=old-runner', 'NGINX_IMAGE=old-proxy',
    "GITLAB_OMNIBUS_CONFIG=puma['worker_processes'] = 2", 'GITLAB_RUNNER_HELPER_IMAGE=candidate-helper:under-test',
    'SYSTEM_WIZARD_ENVIRONMENT_IMAGE=' + id('5')]}, HostConfig: {ExtraHosts: ['gitlab.candidate.test:host-gateway']}};
}
test('manual controller replacement remains discoverable by native Compose without copying image identity labels', async () => {
  const candidate = {inner: async args => calls.push(args)}, calls = [];
  for (const existing of [undefined, {'com.docker.compose.config-hash': 'a'.repeat(64),
    'com.docker.compose.container-number': '9', 'com.docker.compose.oneoff': 'True',
    'com.docker.compose.project': 'old-project', 'com.docker.compose.service': 'old-service',
    'com.docker.compose.project.working_dir': '/native/source', 'com.docker.compose.image': id('2'),
    'org.opencontainers.image.revision': 'b'.repeat(40), 'org.system-bootstrapper.test-job': '31'}]) {
    calls.length = 0;
    const baseline = {...controllerBaseline(), Mounts: [], HostConfig: {RestartPolicy: {Name: 'always'}},
      Config: {...controllerBaseline().Config, Labels: existing}};
    const before = JSON.stringify(baseline);
    await replaceController(candidate, baseline, id('3'));
    assert.deepEqual(calls.map(args => args[0]), ['stop', 'rm', 'create', 'start']);
    const args = calls[2], labels = Object.fromEntries(args.flatMap((value, index) =>
      value === '--label' ? [[args[index + 1].split('=')[0], args[index + 1].slice(args[index + 1].indexOf('=') + 1)]] : []));
    assert.equal(labels['com.docker.compose.project'], 'system');
    assert.equal(labels['com.docker.compose.service'], 'bootstrapper');
    assert.equal(labels['com.docker.compose.container-number'], '1');
    assert.equal(labels['com.docker.compose.oneoff'], 'False');
    assert.match(labels['com.docker.compose.config-hash'], /^[a-f0-9]{64}$/);
    assert(!Object.hasOwn(labels, 'com.docker.compose.image'));
    assert(Object.keys(labels).every(key => key.startsWith('com.docker.compose.')));
    if (existing) {
      assert.equal(labels['com.docker.compose.config-hash'], existing['com.docker.compose.config-hash']);
      assert.equal(labels['com.docker.compose.project.working_dir'], '/native/source');
    }
    assert.equal(JSON.stringify(baseline), before);
  }
});
test('controller override retains fixture adapters while native Compose owns images, storage and staged startup', () => {
  const baseline = controllerBaseline(), before = JSON.stringify(baseline);
  const selected = controllerFixture(baseline, '/recovered-data/platform/fixture').services.bootstrapper;
  assert.deepEqual(Object.keys(selected.environment).sort(), ['GITLAB_OMNIBUS_CONFIG', 'GITLAB_RUNNER_HELPER_IMAGE',
    'SYSTEM_PUBLIC_UPGRADE_FIXTURE', 'SYSTEM_WIZARD_ENVIRONMENT_IMAGE']);
  const core = fs.readFileSync(path.resolve(__dirname, '../../config/system/docker-compose.yml'), 'utf8');
  const environment = core.split('    environment:\n')[1].split('    volumes:\n')[0];
  const nativeKeys = [...environment.matchAll(/^      ([A-Z_]+):/gm)].map(match => match[1]);
  assert(nativeKeys.includes('SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER'));
  assert(nativeKeys.includes('WIZARD_IMAGE'));
  assert.deepEqual(nativeKeys.filter(key => Object.hasOwn(selected.environment, key)), ['SYSTEM_WIZARD_ENVIRONMENT_IMAGE']);
  assert.equal(selected.environment.GITLAB_OMNIBUS_CONFIG, "puma['worker_processes'] = 2");
  assert.deepEqual(selected.extra_hosts, baseline.HostConfig.ExtraHosts);
  assert.equal(selected.network_mode, 'bridge');
  assert(selected.volumes.every(value => value.startsWith('/recovered-data/platform/fixture')));
  assert.equal(JSON.stringify(baseline), before);
});
test('native upgrade waits for selected images and Docker health after recreation and refuses OOM without retrying', async () => {
  const {Candidate} = require('./disposable-candidate');
  let time = 0, inspections = 0;
  const names = ['system_bootstrapper_1', 'system_web_1', 'system_gitlab_1', 'system_wizard_1', 'runner_docker_1'];
  const healthy = names.map(name => ({Name: '/' + name, State: {Running: true, OOMKilled: false,
    ...(name === 'system_gitlab_1' ? {Health: {Status: 'healthy'}} : {})}}));
  let sample = () => {
    if (inspections === 1) throw Error('missing-container-during-recreate');
    if (inspections === 2) return healthy.map(row => row.Name === '/system_gitlab_1' ?
      {...row, State: {...row.State, Health: {Status: 'starting'}}} : row);
    return healthy;
  };
  const candidate = {deadline: 100000, now: () => time, sleep: async milliseconds => { time += milliseconds; },
    wait: Candidate.prototype.wait, inner: async args => {
      assert.deepEqual(args, ['inspect', ...names]); inspections++; return JSON.stringify(sample());
    }};
  await waitForServices(candidate, 3000);
  assert.equal(inspections, 3);
  for (const value of [[], healthy.map(row => ({...row, State: {...row.State, Health: {Status: 'starting'}}}))]) {
    inspections = 0; sample = () => value;
    await assert.rejects(waitForServices(candidate, 2000), /^Error: readiness-timeout$/);
    assert.equal(inspections, 2);
  }
  const selected = Object.fromEntries(names.map((name, index) => [name, id(String(index))]));
  const reconciled = healthy.map(row => ({...row, Image: selected[row.Name.slice(1)]}));
  for (const name of names) {
    const stale = reconciled.map(row => row.Name === '/' + name ? {...row, Image: id('f')} : row);
    inspections = 0; sample = () => inspections === 1 ? stale : reconciled;
    await waitForServices(candidate, 3000, selected);
    assert.equal(inspections, 2, 'healthy previous-generation ' + name + ' must not satisfy image readiness');
    inspections = 0; sample = () => stale;
    await assert.rejects(waitForServices(candidate, 2000, selected), /^Error: readiness-timeout$/);
    assert.equal(inspections, 2);
  }
  for (const invalid of [{unknown: id('a')}, {system_wizard_1: 'private-value'}]) {
    inspections = 0;
    await assert.rejects(waitForServices(candidate, 3000, invalid), /public-upgrade-selected-images-differ/);
    assert.equal(inspections, 0, 'invalid expected identities refuse before Docker');
  }
  inspections = 0; sample = () => healthy.map(row => ({...row, State: {...row.State, OOMKilled: true}}));
  await assert.rejects(waitForServices(candidate, 3000), error => error.message === 'public-upgrade-service-oom' && error.noRetry);
  assert.equal(inspections, 1);
  assert.equal(require('./stage-diagnostics').failureReason('public-upgrade-service-oom'), 'public-upgrade-service-oom');
});
test('native readiness reports terminal service exits but permits scheduled restarts',async()=>{
  const {Candidate}=require('./disposable-candidate');
  const names=['system_bootstrapper_1','system_web_1','system_gitlab_1','system_wizard_1','runner_docker_1'];
  const healthy=names.map(name=>({Name:'/'+name,State:{Status:'running',Running:true}}));
  let time=0,inspections=0,sample;
  const candidate={deadline:100000,now:()=>time,sleep:async ms=>{time+=ms;},wait:Candidate.prototype.wait,
    inner:async()=>{inspections++;return JSON.stringify(sample());}};
  const changed=container=>healthy.map((row,index)=>index===0?{...row,...container}:row);
  for(const container of [
    {State:{Status:'dead',Dead:true,ExitCode:137,Error:'private-docker-error'}},
    {State:{Status:'exited',ExitCode:23},HostConfig:{RestartPolicy:{Name:'no'}}},
    {State:{Status:'exited',ExitCode:0},HostConfig:{RestartPolicy:{Name:'on-failure'}}},
    {State:{Status:'exited',ExitCode:23},RestartCount:2,HostConfig:{RestartPolicy:{Name:'on-failure',MaximumRetryCount:2}}}
  ]){
    inspections=0;sample=()=>changed(container);
    const reason='public-upgrade-service-'+(container.State.Dead?'dead':'exited');
    await assert.rejects(waitForServices(candidate,3000),error=>error.message===reason&&error.noRetry===true&&error.exitCode===container.State.ExitCode);
    assert.equal(inspections,1);assert.equal(require('./stage-diagnostics').failureReason(reason),reason);
  }
  for(const container of [
    {State:{Status:'created',Running:false}},
    {State:{Status:'restarting',Restarting:true}},
    ...['always','unless-stopped'].map(Name=>({State:{Status:'exited',ExitCode:23},HostConfig:{RestartPolicy:{Name}}})),
    {State:{Status:'exited',ExitCode:23},HostConfig:{RestartPolicy:{Name:'on-failure',MaximumRetryCount:0}}},
    {State:{Status:'exited',ExitCode:23},RestartCount:1,HostConfig:{RestartPolicy:{Name:'on-failure',MaximumRetryCount:2}}},
    {State:{Status:'exited',ExitCode:23}}
  ]){
    inspections=0;sample=()=>inspections===1?changed(container):healthy;
    await waitForServices(candidate,3000);assert.equal(inspections,2);
  }
});
test('previous public fixture is selected explicitly and redirects stay anonymous on approved TLS origins', async () => {
  const metadata = fixture();
  assert.deepEqual(await download('example/system', edge.from, async () => Response.json(metadata)), metadata);
  await assert.rejects(download('example/system', edge.from, async () => new Response(null, {status: 302, headers: {location: 'http://attacker.invalid/file'}})), /redirect/);
  await assert.rejects(download('example/system', edge.from, async () => new Response(null, {status: 404})), /unavailable/);
});
test('image preparation verifies manifest/config independently of the exact accepted daemon ID before saving archives', async () => {
  const metadata = fixture(), calls = [];
  let corrupt = image => image, badManifest = false;
  const inspectManifest = async (repository, digest) => {
    calls.push(['manifest', repository, digest]);
    const row = metadata.images[repository.endsWith('wizard') ? 'wizard' : 'controller'];
    return {digest, configDigest: badManifest ? id('f') : row.configDigest};
  };
  const execute = (_command, args) => {
    calls.push(args);
    if (args[0] === 'image' && args[1] === 'inspect') {
      const role = args.at(-1).includes('wizard') ? 'wizard' : 'controller';
      const row = metadata.images[role];
      return JSON.stringify([corrupt({Id: row.imageId, Os: 'linux', Architecture: 'amd64', RepoDigests: ['docker.io/' + row.reference],
        Config: {Labels: {'org.opencontainers.image.revision': metadata.source[role === 'controller' ? 'revision' : 'wizardRevision'],
          'org.system-bootstrapper.test-job': '31', 'org.system-bootstrapper.source-revision': metadata.source.revision}}})]);
    }
    return '';
  };
  const invoke = (inspect = inspectManifest) => prepare('/tmp/public-upgrade-fixture',
    {SYSTEM_TEST_PUBLIC_RELEASE_REPOSITORY: 'example/system'}, execute, async () => Response.json(metadata), inspect);
  for (const store of ['classic', 'containerd']) {
    if (store === 'containerd') for (const row of Object.values(metadata.images)) row.imageId = row.reference.split('@')[1];
    calls.length = 0;
    const result = await invoke();
    assert.equal(result.images.previousController.id, metadata.images.controller.imageId);
    assert.equal(calls.filter(args => args[0] === 'image' && args[1] === 'save').length, 2);
    assert.deepEqual(calls[0], ['manifest', 'example/system', id('1')]);
    assert.equal(calls[1][0], 'pull');
  }
  for (const change of [image => { image.Id = id('f'); }, image => { image.Os = 'other'; },
    image => { image.Architecture = 'arm64'; }, image => { image.RepoDigests = []; },
    image => { image.Config.Labels['org.opencontainers.image.revision'] = 'f'.repeat(40); },
    image => { image.Config.Labels['org.system-bootstrapper.test-job'] = '32'; },
    image => { image.Config.Labels['org.system-bootstrapper.source-revision'] = 'f'.repeat(40); }]) {
    corrupt = image => { change(image); return image; };
    await assert.rejects(invoke(), /image-identity-mismatch/);
  }
  corrupt = image => image; badManifest = true; calls.length = 0;
  await assert.rejects(invoke(), /manifest-identity-mismatch/);
  assert.equal(calls.some(args => args[0] === 'pull'), false);
  for (const inspect of [async () => null, async () => ({digest: id('f'), configDigest: id('3')})]) {
    await assert.rejects(invoke(inspect), /manifest-identity-mismatch/);
  }
  await assert.rejects(invoke(async () => { throw Error('private upstream body'); }), /^Error: previous-public-manifest-verification-failed$/);
});
test('future publication config digests come from verified saved archive bytes in either Docker layout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-upgrade-config-'));
  try {
    const config = Buffer.from('{"architecture":"amd64","os":"linux","config":{"Labels":{"fixture":"distinct-config"}}}\n');
    const digest = crypto.createHash('sha256').update(config).digest('hex');
    for (const filename of [digest + '.json', 'blobs/sha256/' + digest]) {
      fs.mkdirSync(path.dirname(path.join(directory, filename)), {recursive: true});
      fs.writeFileSync(path.join(directory, filename), config);
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify([{Config: filename, Layers: []}]));
      const archive = path.join(directory, 'image.tar');
      execFileSync('tar', ['-cf', archive, '-C', directory, 'manifest.json', filename]);
      assert.equal(archiveConfigDigest(archive), 'sha256:' + digest);
    }
    fs.writeFileSync(path.join(directory, 'blobs/sha256/' + digest), 'changed-config');
    const archive = path.join(directory, 'changed.tar');
    execFileSync('tar', ['-cf', archive, '-C', directory, 'manifest.json', 'blobs/sha256/' + digest]);
    assert.throws(() => archiveConfigDigest(archive), /candidate-archive-config-invalid/);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify([{Config: '../unowned'}]));
    execFileSync('tar', ['-cf', archive, '-C', directory, 'manifest.json']);
    assert.throws(() => archiveConfigDigest(archive), /candidate-archive-config-invalid/);
    assert.throws(() => archiveConfigDigest(archive, (_command, _args, options) => {
      assert.equal(options.maxBuffer, 8 * 1024 ** 2);
      assert.equal(options.timeout, 120000);
      throw Object.assign(Error('private oversized archive output'), {code: 'ENOBUFS'});
    }), /^Error: public-upgrade-candidate-archive-config-invalid$/);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
test('preparation diagnostics expose only bounded source-owned failure codes', () => {
  assert.match(preparationFailure(Error('previous-public-image-identity-mismatch')), /failed: previous-public-image-identity-mismatch;/);
  assert.match(preparationFailure(Error('previous-public-manifest-identity-mismatch')), /failed: previous-public-manifest-identity-mismatch;/);
  assert.equal(preparationFailure(Error('secret token and private upstream output')),
    'Candidate image preparation failed: candidate-preparation-failed; see public build log.');
});
test('source preparation keeps exact target and previous Git objects with a clean native checkout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-upgrade-source-contract-'));
  try {
    const origin = path.join(directory, 'origin'), output = path.join(directory, 'output');
    fs.mkdirSync(origin); fs.mkdirSync(output);
    const git = args => execFileSync('git', ['-C', origin, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git(['init']);
    fs.writeFileSync(path.join(origin, 'VERSION'), edge.to + '\n');
    git(['add', 'VERSION']);
    git(['update-index', '--add', '--cacheinfo', '160000,' + 'c'.repeat(40) + ',wizard']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Prepared source']);
    const revision = git(['rev-parse', 'HEAD']);
    const previous = {source: {repository: origin, revision, tree: git(['rev-parse', 'HEAD^{tree}']), wizardRevision: 'c'.repeat(40)}};
    const execute = (command, args, options) => {
      const sourceRoot = path.resolve(__dirname, '../..');
      return execFileSync(command, args.map(value => value === sourceRoot ? origin : value), options);
    };
    const prepared = prepareSource(output, previous, {...process.env, CI_COMMIT_SHA: revision}, execute);
    assert.match(prepared.sha256, /^[a-f0-9]{64}$/);
    const restored = path.join(directory, 'restored'); fs.mkdirSync(restored);
    execFileSync('tar', ['-xzf', prepared.archive, '-C', restored]);
    assert.equal(execFileSync('git', ['-C', restored, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), revision);
    assert.equal(execFileSync('git', ['-C', restored, 'status', '--porcelain'], {encoding: 'utf8'}), '');
    assert.equal(fs.readFileSync(path.join(restored, 'VERSION'), 'utf8').trim(), edge.to);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
test('same candidate drives real CLI operations, interrupted offline recovery and restart before recording evidence', async () => {
  const metadata = fixture(), events = [];
  const files = {'.docker.env': "# fixture\nexport BOOTSTRAPPER_IMAGE='old'\nexport WIZARD_IMAGE='custom'\nKEEP='yes'\n", '.projects.env/.demo.env': 'project-source-preserved\n'};
  let selected = [id('5'), id('6')], working = {...files}, phase = 'planned', controller = 'not-started', interrupt = false;
  const candidate = {spec: {restore: {base: '/recovered-data/platform'}, publicUpgrade: {metadata, edge}, images: {candidate: {id: id('5')}, wizard: {id: id('6')}}},
    evidence: {}, stage: async (_name, action) => action(), call: async () => {}, inner: async () => ''};
  const native = {createCredential: async () => {}, initialize: async () => { events.push('initialize'); selected = [id('3'), id('4')]; },
    cli: async (operation, confirmation) => {
      events.push(operation);
      if (operation === 'plan') return {installedVersion: edge.from, targetVersion: edge.to, confirmPlanSha256: 'a'.repeat(64), ...(edge.databaseMigration ? {gitlabPrerequisite:{fromVersion:'19.5.3',toVersion:'19.6.1',checkpointSha256:'b'.repeat(64)}} : {})};
      if (operation === 'apply') {
        if (confirmation !== 'a'.repeat(64)) throw Error('confirmation-refused');
        phase = controller = 'completed'; selected = [id('5'), id('6')];
        return {phase, dataSampleVerified: true};
      }
      if (operation === 'recover') {
        if (interrupt) { interrupt = false; controller = 'rollback-started'; throw Error('one-shot-recovery-failure'); }
        phase = controller = 'rolled-back'; selected = [id('3'), id('4')];
        working = {...files, '.docker.env': files['.docker.env'].replace("'old'", "'system-bootstrapper-recovery:" + 'b'.repeat(64) + "'").replace("'custom'", "'system-bootstrapper-recovery:" + 'c'.repeat(64) + "'")};
      }
      return {operation: {phase, recoveryImageSelectors: phase === 'rolled-back'}, controller};
    }, offline: async () => events.push('old-images-removed'), interruptRecovery: async () => { interrupt = true; },
    restoreOriginal: async () => { events.push('restore-original'); working = {...files}; },
    finish: async () => { events.push('finish'); selected = [id('5'), id('6')]; },
    revokeCredential: async () => events.push('revoke')};
  const dependencies = {configuration: async () => working, native,
    storage: {attach: async () => events.push('backup-attached'), detach: async () => events.push('backup-detached')}, baseline: {Image: id('5')},
    verify: async () => {}, dataSample: async () => ({sha256: 'a'.repeat(64), sampledProjects: 1}), imageIds: async () => selected};
  await run(candidate, {}, dependencies);
  assert.deepEqual(events, ['backup-attached', 'initialize', 'plan', 'apply', 'apply', 'status', 'backup-detached', 'old-images-removed',
    'recover', 'status', 'recover', 'status', 'restore-original', 'finish', 'revoke']);
  assert.equal(candidate.evidence.publicUpgrade.rollbackVerified, true);
  assert.equal(candidate.evidence.publicUpgrade.fromSourceRevision, metadata.source.revision);
  // The real combined flow has already migrated GitLab. Reuse that session and
  // leave recovered selectors intact until the one final database rollback.
  events.length=0;working={...files};selected=[id('5'),id('6')];
  native.preparedMigration=true;native.live='/recovered-data/platform';
  native.planDir='/recovered-data/platform/recovery/upgrade-plans/candidate-fixture';
  native.selectMigratedPublic=async()=>{events.push('reuse-migrated');selected=[id('3'),id('4')];};
  await run(candidate,{},dependencies);
  assert.deepEqual(events,['backup-attached','reuse-migrated','plan','apply','apply','status','backup-detached','old-images-removed',
    'recover','status','recover','status']);
  assert.equal(native.pairedCheckpoint,'/recovered-data/platform/recovery/controller-updates/candidate-fixture');
  assert(working['.docker.env'].includes('system-bootstrapper-recovery:'));
  delete native.preparedMigration;

  delete candidate.evidence.publicUpgrade;
  let verifications=0;
  dependencies.verify=async()=>{if(++verifications===5)throw Error('final-proof-failed');};
  await assert.rejects(run(candidate,{},dependencies),/final-proof-failed/);
  assert.equal(events.at(-1),'revoke','the caller-owned credential must be revoked when final verification fails');
  assert.equal(candidate.evidence.publicUpgrade,undefined);
  dependencies.verify = async () => { throw Error('registry-or-data-failed'); };
  await assert.rejects(run(candidate, {}, dependencies), /registry-or-data-failed/);
  assert.equal(candidate.evidence.publicUpgrade, undefined);
  assert.equal(preserved(files), preserved({...files, '.docker.env': files['.docker.env'].replace("'old'", "'target'")}));
});

test('registry adapter preserves arguments and disables previous digest transport during real archive recovery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-upgrade-transport-'));
  try {
    const script = path.resolve(__dirname, '../e2e/public-upgrade-docker.js');
    const docker = path.join(directory, 'docker'), compose = path.join(directory, 'docker-compose');
    fs.symlinkSync(script, docker); fs.symlinkSync(script, compose);
    const reference = 'example/system@' + id('1'), image = id('3');
    fs.writeFileSync(path.join(directory, 'images.tsv'), reference + '\t' + image + '\tprevious\n');
    fs.mkdirSync(path.join(directory,'runtime'));
    fs.symlinkSync(path.resolve(__dirname,'../../dist'),path.join(directory,'runtime/dist'));
    fs.symlinkSync(path.resolve(__dirname,'../../node_modules'),path.join(directory,'runtime/node_modules'));
    fs.writeFileSync(path.join(directory, 'docker.native'), '#!'+process.execPath+'\n'+
      `const fs=require('node:fs');fs.writeFileSync(process.env.SYSTEM_PUBLIC_UPGRADE_FIXTURE+'/arguments',process.argv.slice(2).join('\\n')+'\\n');
       if(process.env.SYSTEM_TEST_NATIVE_SIGNAL)process.kill(process.pid,process.env.SYSTEM_TEST_NATIVE_SIGNAL);
       if(process.env.SYSTEM_TEST_NATIVE_FAILURE){console.log('[{"RepoDigests":[]}]');process.exit(Number(process.env.SYSTEM_TEST_NATIVE_FAILURE));}
       console.log(process.env.SYSTEM_TEST_NATIVE_INSPECT||JSON.stringify([{Id:${JSON.stringify(image)},RepoDigests:[]}]))`, {mode:0o755});
    fs.writeFileSync(path.join(directory, 'docker-compose.native'), '#!'+process.execPath+'\n'+
      `require('node:fs').writeFileSync(process.env.SYSTEM_PUBLIC_UPGRADE_FIXTURE+'/arguments',process.argv.slice(2).join('\\n')+'\\n');process.stdout.write(process.env[process.env.SYSTEM_TEST_COMPOSE_KEY||'BOOTSTRAPPER_IMAGE']||'');`, {mode:0o755});
    const {PublicUpgradeTransportService}=require('../../dist/modules/testing/public-upgrade-transport.service');
    let output='';
    const service=new PublicUpgradeTransportService({write:bytes=>{output+=bytes.toString();}});
    const invoke=async(program,args,options)=>{
      output='';
      const result=await service.docker(program,args,options.env);
      if(result.status!==0||result.signal)throw Object.assign(Error('fixture transport failed'),result);
      return output;
    };
    const env = {...process.env, SYSTEM_PUBLIC_UPGRADE_FIXTURE: directory};
    const args = ['--host=unix:///var/run/docker.sock', 'image', 'inspect', reference];
    // One actual CLI launch proves module/argv wiring; variants exercise that same
    // compiled service directly and still invoke the real native fixture process.
    const inspected = JSON.parse(execFileSync(process.execPath,[docker,...args],{env,encoding:'utf8'}));
    assert.equal(inspected[0].Id, image);
    assert.deepEqual(inspected[0].RepoDigests, [reference]);
    for (const indent of [4]) {
      const native = [{Id: image, RepoDigests: ['system-candidate@' + id('7'), 'example/existing@' + id('8')],
        RepoTags: ['candidate:under-test'], Config: {Labels: {fixture: 'preserved'}}, Size: 123}];
      const result = JSON.parse(await invoke(docker, args,
        {env: {...env, SYSTEM_TEST_NATIVE_INSPECT: JSON.stringify(native, null, indent)}, encoding: 'utf8'}));
      assert.deepEqual(result, [{...native[0], RepoDigests: [reference]}]);
    }
    await assert.rejects(() => invoke(docker, args, {env: {...env, SYSTEM_TEST_NATIVE_FAILURE: '17'}, stdio: 'pipe'}),
      error => error.status === 17, 'failed native inspection must never become successful fabricated identity');
    await assert.rejects(() => invoke(docker, ['info'], {env:{...env,SYSTEM_TEST_NATIVE_FAILURE:'23'},stdio:'pipe'}),error=>error.status===23);
    assert.throws(() => execFileSync(process.execPath,[docker,'info'], {env:{...env,SYSTEM_TEST_NATIVE_SIGNAL:'SIGTERM'},stdio:'pipe'}),error=>error.signal==='SIGTERM');
    await invoke(docker, ['--host=unix:///var/run/docker.sock','pull','docker.io/'+reference], {env});
    assert.deepEqual(fs.readFileSync(path.join(directory,'arguments'),'utf8').trim().split('\n'),['image','inspect',image]);
    await invoke(docker, ['exec', 'fixture', 'printf', '%s', 'one two'], {env});
    assert.equal(fs.readFileSync(path.join(directory, 'arguments'), 'utf8').split('\n').at(-2), 'one two');
    const composed = await invoke(compose, ['-f', '/source/system/docker-compose.yml', 'up', '--no-build', '-d', 'bootstrapper'],
      {env: {...env, BOOTSTRAPPER_IMAGE: reference}, encoding: 'utf8'});
    assert.equal(composed, image);
    assert.match(fs.readFileSync(path.join(directory, 'arguments'), 'utf8'), new RegExp('-f\\n' + directory + '/compose.yml\\nup'));
    assert.equal(await invoke(docker,['--host=unix:///var/run/docker.sock','compose','-f','/source/system/docker-compose.yml','create','bootstrapper'],{env:{...env,BOOTSTRAPPER_IMAGE:reference},encoding:'utf8'}),image);
    fs.writeFileSync(path.join(directory, 'offline-recovery'), 'offline');
    const support='example/security@'+id('6');
    fs.appendFileSync(path.join(directory,'images.tsv'),support+'\t'+image+'\tsupport\n');
    for(const key of ['GITLAB_IMAGE','GITLAB_RUNNER_IMAGE','GITLAB_RUNNER_HELPER_IMAGE']){
      assert.equal(await invoke(compose,['-f','/source/system/docker-compose.yml','create','gitlab'],
        {env:{...env,[key]:support,SYSTEM_TEST_COMPOSE_KEY:key}}),image);
    }
    await invoke(docker,['image','inspect',support],{env});

    await assert.rejects(() => invoke(docker, args, {env, stdio: 'pipe'}), error => error.status === 87);
    await invoke(docker, ['image', 'inspect', 'system-bootstrapper-recovery:' + 'a'.repeat(64)], {env});
    fs.writeFileSync(path.join(directory, 'fail-recovery-once'), 'once');
    const recoveryEnv = {...env, BOOTSTRAPPER_IMAGE: 'system-bootstrapper-recovery:' + 'a'.repeat(64)};
    await assert.rejects(() => invoke(compose, ['-f', '/source/system/docker-compose.yml', 'up', '-d', 'bootstrapper'],
      {env: recoveryEnv, stdio: 'pipe'}), error => error.status === 88);
    assert.equal(fs.existsSync(path.join(directory, 'fail-recovery-once')), false);
    await invoke(compose, ['-f', '/source/system/docker-compose.yml', 'up', '-d', 'bootstrapper'], {env: recoveryEnv});
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('mount adapter only models the exact owned live filesystem and delegates backup or unrelated paths', async () => {
  const script = path.resolve(__dirname, '../e2e/public-upgrade-findmnt.js');
  const env = {...process.env, SYSTEM_PUBLIC_UPGRADE_LIVE: '/recovered-data/platform'};
  assert.equal(execFileSync(process.execPath, [script, '-rn', '-T', '/recovered-data/platform/configuration', '-o', 'MAJ:MIN'], {env, encoding: 'utf8'}), '0:1\n');
  const {PublicUpgradeTransportService}=require('../../dist/modules/testing/public-upgrade-transport.service');
  let output='';const service=new PublicUpgradeTransportService({write:bytes=>{output+=bytes.toString();}});
  for (const target of new Set(['/tmp', os.tmpdir()])) {
    const args = ['-rn', '-T', target, '-o', 'MAJ:MIN'];
    output='';assert.equal((await service.findmnt(args,env)).status,0);
    assert.equal(output,execFileSync('/usr/bin/findmnt', args, {encoding: 'utf8'}));
  }
});

test('native host helper mounts backup strictly for plan/apply and performs recovery/status without backup storage', async () => {
  const calls = [], candidate = {id: 'a'.repeat(24), spec: {restore: {base: '/recovered-data/platform'}, images: {gitlab: {id: id('7')},candidate:{id:id('8')}}},
    inner: async args => { calls.push(args); return '{}'; }};
  const native = new NativeCLI(candidate);

  candidate.spec.publicUpgrade={metadata:fixture(),edge};
  native.pairedCheckpoint=native.live+'/recovery/controller-updates/candidate-'+candidate.id;
  for(const operation of ['prepare','plan','promote','status','rollback']){
    await native.gitlab(operation,['promote','rollback'].includes(operation)?'b'.repeat(64):undefined);
    const args=calls.at(-1);
    assert(args.includes('--pid')&&args[args.indexOf('--pid')+1]==='host');
    assert(!args.some(value=>value.includes('/external-seed')));
    assert(args.includes('gitlab'));assert(args.includes(native.fixture+'/source'));
    assert(args.includes(native.live+'/configuration/gitlab-prerequisites/candidate-'+candidate.id));
    assert.equal(args.includes('--paired-checkpoint'),operation==='rollback');
    assert.equal(args.includes('--confirm-checkpoint'),operation==='rollback');
    assert.equal(args.includes('--confirm-plan'),operation==='promote');
  }
  calls.length=0;
  await native.invoke(['--operation', 'plan']);
  assert(calls[0].includes('type=bind,src=/external-seed,dst=/external-seed'));
  assert(calls[0].includes(native.fixture + '/source:' + native.fixture + '/source:ro'));
  for(const library of ['/lib/ld-musl-x86_64.so.1','/usr/lib/libstdc++.so.6','/usr/lib/libgcc_s.so.1'])
    assert(calls[0].includes(native.fixture+'/runtime'+library+':'+library+':ro'));
  assert(calls[0].includes(native.fixture+'/runtime:/opt/system-public-upgrade:ro'));
  await native.write(native.fixture+'/token','fixture-private-token');
  const write=calls.at(-1);assert(write.includes('/usr/local/bin/node'));assert(write.includes('write'));
  assert(!write.includes('sh'));assert(!write.includes('fixture-private-token'));

  for (const operation of ['recover', 'status', 'restore-original']) {
    await native.invoke(operation === 'restore-original' ? [operation] : ['--operation', operation]);
    assert(!calls.at(-1).some(value => value.includes('/external-seed')));
    assert(calls.at(-1).includes('/var/run/docker.sock:/var/run/docker.sock'));
    assert(calls.at(-1).includes('--entrypoint'));
  }
  candidate.inner=async(args,options)=>{assert.equal(options.timeout,5000);assert.deepEqual(args.slice(0,4),['exec','system_bootstrapper_1','node','-e']);return JSON.stringify({phase:'completed',exitCode:124,private:'private-token'});};
  const failure=await native.captureGitlabFailure();assert.deepEqual(failure,{phase:'completed',exitCode:124});
  const {recover}=require('./disposable-candidate');
  assert.deepEqual(recover({runId:candidate.id,resources:[],results:[],evidence:{gitlabUpgradeFailure:{...failure,private:'private-token'}}}).evidence.gitlabUpgradeFailure,failure);
  candidate.inner=async()=>{throw Error('private-token');};
  assert.deepEqual(await native.captureGitlabFailure(),{phase:'unavailable'});
});

test('native helper diagnostics identify only the declared phase and preserve bounded exit facts', async () => {
  const {failureReason}=require('./stage-diagnostics');
  const candidate={id:'a'.repeat(24),spec:{restore:{base:'/recovered-data/platform'},images:{candidate:{id:id('7')}}},
    inner:async()=>{throw Object.assign(Error('private credential and upstream stderr'),{exitCode:1,systemCode:'ENOENT'});}};
  const native=new NativeCLI(candidate);
  for(const operation of ['initialize','restore-original','plan','apply','status','recover','gitlab-prepare','gitlab-plan','gitlab-promote','gitlab-status','gitlab-abort','gitlab-rollback']){
    const args=operation.startsWith('gitlab-')?['gitlab','--operation',operation.slice(7)]:['initialize','restore-original'].includes(operation)?[operation]:['--operation',operation];
    await assert.rejects(()=>native.invoke(args),error=>{
      assert.equal(error.message,'public-upgrade-native-'+operation+'-failed');
      assert.equal(failureReason(error.message),error.message);
      assert.equal(error.exitCode,1);assert.equal(error.systemCode,'ENOENT');
      assert(!JSON.stringify(error).includes('credential'));return true;
    });
  }
  candidate.inner=async()=>{throw Error('canceled-or-overall-timeout');};
  await assert.rejects(()=>native.invoke(['initialize']),/^Error: canceled-or-overall-timeout$/);
  for(const reason of ['candidate-overall-timeout','candidate-cleanup-timeout']){
    const failure=Object.assign(Error(reason),{systemCode:'ETIMEDOUT',noRetry:true});
    candidate.inner=async()=>{throw failure;};
    await assert.rejects(()=>native.invoke(['--operation','recover']),error=>{
      assert.equal(error,failure);assert.equal(error.message,reason);assert.equal(error.systemCode,'ETIMEDOUT');
      assert.equal(error.noRetry,true);assert.equal(error.exitCode,undefined);assert.equal(failureReason(error.message),reason);return true;
    });
  }
});

test('fixed native diagnostic markers survive the real Docker sanitizer and native phase wrapper',async()=>{
  const {Candidate}=require('./disposable-candidate');
  const {failureReason}=require('./stage-diagnostics');
  const diagnostics=require('../e2e/public-upgrade-diagnostics.json');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'public-upgrade-diagnostics-'));
  const previousPath=process.env.PATH,previousError=process.env.SYSTEM_TEST_PUBLIC_UPGRADE_ERROR;
  try{
    fs.writeFileSync(path.join(directory,'docker'),'#!'+process.execPath+'\nconsole.error(process.env.SYSTEM_TEST_PUBLIC_UPGRADE_ERROR);process.exit(7);\n',{mode:0o755});
    process.env.PATH=directory+path.delimiter+previousPath;
    const images=Object.fromEntries(['candidate','wizard','gitlab','runner','nginx'].map(role=>[role,{id:id('7'),archive:'/unused/'+role+'.tar'}]));
    const candidate=new Candidate({example:fs.readFileSync(path.resolve(__dirname,'../../config/system/.docker.env.example'),'utf8'),
      daemonImage:'docker@'+id('8'),images,restore:{base:'/recovered-data/platform'}});
    candidate.daemon='owned-disposable-daemon';
    const native=new NativeCLI(candidate);
    const phases=['initialize','restore-original','plan','apply','status','recover','gitlab-prepare','gitlab-plan','gitlab-promote','gitlab-status','gitlab-abort','gitlab-rollback'];
    const codes=['docker-command-failed','release-changed-after-plan','image-archive-failed-or-timed-out',
      'upgrade-command-preflight-sql-timeout','upgrade-command-migration-status-nonzero-exit',
      'public-gitlab-prerequisite-not-declared','public-gitlab-retained-input-mismatch','public-gitlab-installed-controller-mismatch',
      'public-gitlab-helper-runtime-overlay-refused','public-gitlab-helper-authority-mismatch','public-gitlab-helper-outcome-uncertain',
      ...Object.values(diagnostics.dockerOperations)];
    // Cover every distinct sanitizer code and phase without their redundant Cartesian product.
    for(let index=0;index<Math.max(phases.length,codes.length);index++){
      const operation=phases[index%phases.length],code=codes[index%codes.length];
      process.env.SYSTEM_TEST_PUBLIC_UPGRADE_ERROR='private-token\n'+diagnostics.marker+code+'\nprivate-stderr';
      const args=operation.startsWith('gitlab-')?['gitlab','--operation',operation.slice(7)]:['initialize','restore-original'].includes(operation)?[operation]:['--operation',operation];
      await assert.rejects(()=>native.invoke(args),error=>{
        assert.equal(error.message,'public-upgrade-native-'+operation+'-'+code);
        assert.equal(failureReason(error.message),error.message);
        assert.equal(error.exitCode,7);assert(!JSON.stringify(error).includes('private'));return true;
      });
    }
    for(const message of [diagnostics.marker+'private-token',diagnostics.marker+'docker-command-failed private-token',
      'prefix '+diagnostics.marker+'docker-command-failed',diagnostics.marker+'docker-data-sample-failed private-token',
      diagnostics.marker+'public-gitlab-retained-input-mismatch private-token']){
      process.env.SYSTEM_TEST_PUBLIC_UPGRADE_ERROR=message;
      await assert.rejects(()=>native.invoke(['--operation','plan']),error=>error.message==='public-upgrade-native-plan-failed'&&error.exitCode===7);
    }
    assert.equal(failureReason('public-upgrade-native-plan-private-token'),'stage-error');
    assert.equal(failureReason('public-upgrade-native-gitlab-prepare-private-token'),'stage-error');
    await assert.rejects(()=>native.invoke(['gitlab','--operation','private-token']),/^Error: public-upgrade-native-operation-invalid$/);
  }finally{
    process.env.PATH=previousPath;
    if(previousError===undefined)delete process.env.SYSTEM_TEST_PUBLIC_UPGRADE_ERROR;else process.env.SYSTEM_TEST_PUBLIC_UPGRADE_ERROR=previousError;
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('fixture credential revocation uses the authenticated API before any Rails fallback',async()=>{
  let rails=0;
  const candidate={id:'a'.repeat(24),spec:{restore:{base:'/recovered-data/platform'}},
    api:async(route,token,method)=>{assert.equal(route,'/personal_access_tokens/self');assert.equal(token,'fixture-token');assert.equal(method,'DELETE');},
    rails:async()=>{rails++;}};
  const native=new NativeCLI(candidate);native.token={token:'fixture-token',root_id:1};
  await native.revokeCredential();assert.equal(rails,0);
  candidate.api=async()=>{throw Error('unavailable');};
  await native.revokeCredential();assert.equal(rails,1);
});

test('native fixture selection adapts only the exact candidate and preserves original selection bytes', () => {
  const {PublicUpgradeSelectionService} = require('../../dist/modules/testing/public-upgrade-selection.service');
  const {imageAssignment} = require('../../dist/modules/host/release-selection.service');
  const service = new PublicUpgradeSelectionService(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-selection-'));
  try {
    const live = path.join(directory, 'live'), configuration = path.join(live, 'configuration');
    fs.mkdirSync(configuration, {recursive:true});
    const raw = Buffer.concat([fs.readFileSync(path.join(__dirname, '../../config/system/.docker.env.example')), Buffer.from("\nexport BOOTSTRAPPER_IMAGE='"+id('5')+"'\nexport WIZARD_IMAGE='"+id('6')+"'\n")]);
    const metadata = fixture(), input = {live,previous:metadata,spec:{images:{candidate:{id:id('5')},wizard:{id:id('6')}}}};
    const main = path.join(configuration,'.docker.env'), profile = path.join(configuration,'.release-images.env');
    fs.writeFileSync(main,raw,{mode:0o600});fs.writeFileSync(profile,'original-profile\n',{mode:0o600});
    assert.throws(()=>imageAssignment(raw,metadata.images.controller.reference),/public-dockerhub-digest-required/);
    assert.deepEqual(service.execute(directory,'initialize',input),{initialized:true});
    const initialized=fs.readFileSync(main);
    assert(initialized.subarray(0,1184).equals(raw.subarray(0,1184)));
    for(const role of ['controller','wizard'])assert(initialized.includes(metadata.images[role].reference));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(configuration,'.release-images.json'))).images,metadata.images);
    assert.throws(()=>service.execute(directory,'initialize',input),/candidate-controller-selector-mismatch|fixture-already-initialized/);
    const originalReceipt=fs.readFileSync(path.join(directory,'original-selection.json'));
    service.migrated(directory,'save-migrated-public-selection',input);
    assert.throws(()=>service.migrated(directory,'save-migrated-public-selection',input),/already-saved/);
    service.migrated(directory,'candidate-pair-selectors',input);
    assert(fs.readFileSync(main).includes(id('5')));
    assert.equal(fs.readFileSync(profile,'utf8'),'original-profile\n');
    assert(fs.readFileSync(path.join(directory,'original-selection.json')).equals(originalReceipt));
    service.migrated(directory,'restore-migrated-public-selection',input);
    assert(fs.readFileSync(main).equals(initialized));
    const changed=initialized.toString().replace(/^export GITLAB_IMAGE=.*$/m,"export GITLAB_IMAGE='foreign'");
    fs.writeFileSync(main,changed);
    assert.throws(()=>service.migrated(directory,'restore-migrated-public-selection',input),/service-selection-changed/);
    assert.equal(fs.readFileSync(main,'utf8'),changed);
    fs.writeFileSync(main,initialized);

    assert.deepEqual(service.execute(directory,'restore-original',input),{restored:true});
    assert.equal(fs.readFileSync(profile,'utf8'),'original-profile\n');assert(!fs.existsSync(path.join(configuration,'.release-images.json')));
    for(const invalid of [Buffer.from(raw.toString().replace(id('5'),id('7'))),Buffer.concat([raw,Buffer.from("export BOOTSTRAPPER_IMAGE='"+id('5')+"'\n")])]){
      assert.throws(()=>service.previousConfiguration(invalid,input),/candidate-controller-/);
    }
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('future publication fixture is deterministic and verified by the production authority', () => {
  const {PublicUpgradePublicationService} = require('../../dist/modules/testing/public-upgrade-publication.service');
  const {HostReleaseAuthorityService} = require('../../dist/modules/host/release-authority.service');
  const root=path.resolve(__dirname,'../..'), security=require('../../config/gitlab/security-release.json');
  const input=require('./public-upgrade-fixture').publicationFixture();
  const service=new PublicUpgradePublicationService({verify(){throw Error('unexpected checkpoint');}});
  const first=service.prepare(root,input), second=service.prepare(root,input);
  assert(first.proof.equals(second.proof));assert.deepEqual(first.metadata,second.metadata);
  const generate = "const {PublicUpgradePublicationService}=require('./dist/modules/testing/public-upgrade-publication.service');const input=require('./tests/shared/public-upgrade-fixture').publicationFixture();process.stdout.write(new PublicUpgradePublicationService({verify(){throw Error('unexpected checkpoint');}}).prepare(process.cwd(),input).proof)";
  assert(first.proof.equals(execFileSync(process.execPath,['-e',generate],{cwd:root})), 'fresh CLI process must reproduce publication bytes');
  const authority=new HostReleaseAuthorityService({});
  const accepted=authority.publicInputs(first.metadata,first.proof,security);
  assert.equal(accepted.release.imageId,input.spec.images.candidate.id);assert.equal(accepted.release.wizardImageId,input.spec.images.wizard.id);
  assert.throws(()=>authority.publicInputs({...first.metadata,publicUpgrade:{...first.metadata.publicUpgrade,sha256:'0'.repeat(64)}},first.proof,security),/provenance-hash/);
  assert.equal(input.gitlabUpgrade.rollbackVerified,undefined,'synthetic future gates never mutate candidate evidence');
  const future=structuredClone(input);future.edge=edge;future.previous.version=edge.from;future.previous.tag='v'+edge.from;future.publicationMode='future-release-before-prerequisite-v1';
  for(const key of ['checkpointVerified','migrationVerified','registryVerified','securityTrustVerified','runnerUpgradeVerified'])delete future.gitlabUpgrade[key];
  const before=JSON.stringify(future);
  const frozen=service.prepare(root,future);
  assert.equal(JSON.stringify(future),before,'future publication never invents observed candidate evidence');
  assert(frozen.proof.equals(service.prepare(root,future).proof));
  authority.publicInputs(frozen.metadata,frozen.proof,security);

});

test('native host fixture keeps diagnostics fixed and runs initialization through the shared Nest module', async () => {
  const {upgradeCommandFailureCodes}=require('../../dist/modules/gitlab-upgrade/command-failure-policy');
  const {fixtureDiagnostic}=require('../../dist/modules/testing/public-upgrade-host-entry');
  const {PublicUpgradeHostService}=require('../../dist/modules/testing/public-upgrade-host.service');
  const {HostPolicyError}=require('../../dist/modules/host/install');
  const diagnostics=require('../e2e/public-upgrade-diagnostics.json');
  for(const code of upgradeCommandFailureCodes)assert.equal(diagnostics.errors[code],code);
  for(const [label,code] of Object.entries(diagnostics.errors)){
    assert.equal(fixtureDiagnostic(new HostPolicyError(label),diagnostics),code);
    for(const error of [new Error(label),new HostPolicyError(label+':private-token'),new HostPolicyError('private-token:'+label)])
      assert.equal(fixtureDiagnostic(error,diagnostics),diagnostics.fallback);
  }
  assert.equal(fixtureDiagnostic(Object.assign(new Error('/private/secret'),{code:'ENOENT'}),diagnostics),'file-missing');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'public-host-module-'));
  try{
    const root=path.resolve(__dirname,'../..'), input=require('./public-upgrade-fixture').publicationFixture();
    input.live=path.join(directory,'live');fs.mkdirSync(path.join(input.live,'configuration'),{recursive:true});
    fs.symlinkSync(root,path.join(directory,'source'),'dir');
    fs.writeFileSync(path.join(directory,'fixture.json'),JSON.stringify(input),{mode:0o600});
    const main=path.join(input.live,'configuration/.docker.env');
    fs.writeFileSync(main,Buffer.concat([fs.readFileSync(path.join(root,'config/system/.docker.env.example')),Buffer.from("\nexport BOOTSTRAPPER_IMAGE='"+input.spec.images.candidate.id+"'\nexport WIZARD_IMAGE='"+input.spec.images.wizard.id+"'\n")]),{mode:0o600});
    const original=fs.readFileSync(main), security=require('../../config/gitlab/security-release.json');
    const service=new PublicUpgradeHostService();service.read=()=>input;
    fs.mkdirSync(path.join(input.live,'runners'));
    const aliases=[['GITLAB_IMAGE','candidate-gitlab:under-test',security.fromImage],['GITLAB_RUNNER_IMAGE','candidate-runner:under-test',security.runner.fromImage]];
    const select=render=>aliases.reduce((text,[key,alias])=>text.replace(new RegExp('^export '+key+'=.*$','m'),()=>render(key,alias)),original.toString());
    for(const render of [(key,alias)=>key+'='+alias,(key,alias)=>'export '+key+"='"+alias+"'",(key,alias)=>'export '+key+'="'+alias+'"']){
      const raw=select(render)+"\nLITERAL_NOTE='keep\nexport GITLAB_IMAGE=foreign\nall these bytes'\n";
      fs.writeFileSync(main,raw);
      assert.deepEqual(await service.execute(directory,'gitlab-previous-selectors'),{selected:true});
      const expected=aliases.reduce((text,[key,,reference])=>text.replace(new RegExp('^(?:export )?'+key+'=.*$','m'),()=>"export "+key+"='"+reference+"'"),raw);
      assert.equal(fs.readFileSync(main,'utf8'),expected,'only the two actual image assignments change');
      assert(fs.readFileSync(main).subarray(0,1184).equals(original.subarray(0,1184)));
    }
    const baseline=select((key,alias)=>'export '+key+'="'+alias+'"');
    for(const invalid of [
      baseline.replace('candidate-gitlab:under-test','foreign'),
      baseline.replace('candidate-runner:under-test','foreign'),
      baseline+'\nGITLAB_IMAGE=candidate-gitlab:under-test\n',
      baseline+'\nexport GITLAB_RUNNER_IMAGE="candidate-runner:under-test"\n',
      baseline.replace('export GITLAB_IMAGE=','unset GITLAB_IMAGE\nexport GITLAB_IMAGE='),
      baseline+'\nunset GITLAB_RUNNER_IMAGE\n',
      baseline.replace('candidate-gitlab:under-test','$(touch /private/never-run)'),
      baseline.replace('candidate-runner:under-test','$FOREIGN'),
      baseline.replace(/^export GITLAB_RUNNER_IMAGE=.*\n/m,''),
    ]){
      fs.writeFileSync(main,invalid);
      await assert.rejects(service.execute(directory,'gitlab-previous-selectors'),/candidate-previous-service-selector-required/);
      assert.equal(fs.readFileSync(main,'utf8'),invalid,'invalid selector refuses before writing either assignment');
    }
    fs.writeFileSync(main,original);
    fs.mkdirSync(path.join(directory,'runtime'),{recursive:true});
    const {PublicUpgradeRuntimeService}=require('../../dist/modules/testing/public-upgrade-runtime.service');
    new PublicUpgradeRuntimeService().copyApplication(root,path.join(directory,'runtime'));
    const runtime=path.join(directory,'runtime');
    for(const name of ['dist','node_modules','assets'])assert(fs.statSync(path.join(runtime,name)).isDirectory(), 'relocated Root runtime contains '+name);
    assert(fs.readFileSync(path.join(runtime,'package.json')).equals(fs.readFileSync(path.join(root,'package.json'))));
    assert(fs.readFileSync(path.join(runtime,'config/gitlab/security-release.json')).equals(fs.readFileSync(path.join(root,'config/gitlab/security-release.json'))));
    assert(!fs.existsSync(path.join(runtime,'operations')), 'relocated runtime uses the native Root package');
    assert(!fs.existsSync(path.join(runtime,'gitlab/upgrade-child.js')), 'process watchdog is compiled with the native application');
    const entry=path.join(root,'tests/e2e/public-upgrade-host.js');
    const result=execFileSync(process.execPath,[entry,'initialize'],{env:{...process.env,SYSTEM_PUBLIC_UPGRADE_FIXTURE:directory},encoding:'utf8'});
    assert.deepEqual(JSON.parse(result),{initialized:true});
    const {NestFactory}=require('../../node_modules/@nestjs/core');
    const {PublicUpgradeHostModule}=require('../../dist/modules/testing/public-upgrade-host.module');
    const {fixtureHostProcess}=require('../../dist/modules/testing/public-upgrade-host.service');
    const app=await NestFactory.createApplicationContext(PublicUpgradeHostModule.register(directory,root),{logger:false,abortOnError:false});
    try{
      const service=app.get(PublicUpgradeHostService),request=service.transport(directory,root);
      const previous=await request('https://github.com/example/system/releases/download/v1.1.3/system-release-v1.1.3.json');
      assert.deepEqual(await previous.json(),input.previous);
      const target=await request('https://github.com/example/system/releases/download/v1.2.0/system-release-v1.2.0.json');
      assert.equal((await target.json()).version,'1.2.0');
      for(const url of ['https://github.com/foreign/system/releases/download/v1.2.0/system-release-v1.2.0.json','https://github.com/example/system/releases/download/v1.2.0/foreign.json'])await assert.rejects(request(url),/candidate-public-/);
      assert.equal(fixtureHostProcess.run('systemctl',['is-active','certbot.timer']).stdout,'active\n');
      assert.equal(fixtureHostProcess.run(process.execPath,['-e',"process.stdout.write('native')"]).stdout,'native');
    }finally{await app.close();}
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
