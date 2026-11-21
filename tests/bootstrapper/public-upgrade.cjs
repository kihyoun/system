const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { fixture, image, reference } = require('./paired-native-fixture.cjs');
const { PublicUpgradeService } = require('../../dist/modules/host/public-upgrade.service'),
  { PublicUpgradePlanService } = require('../../dist/modules/host/public-upgrade-plan.service'),
  {
    PublicUpgradeApplyService,
  } = require('../../dist/modules/host/public-upgrade-apply.service'),
  { UpgradeLifecycleService } = require('../../dist/modules/host/upgrade-lifecycle.service'),
  { bytesSha } = require('../../dist/modules/host/release-selection.service');
function publicFixture(t) {
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 20 * 1024 ** 3, bsize: 1 }));
  const f = fixture(t, { selected: true }),
    graph = require('../../config/releases/upgrade-paths.json'),
    previous = {
      version: '1.2.0',
      source: { revision: 'd'.repeat(40), tree: 'e'.repeat(40), wizardRevision: 'f'.repeat(40) },
      images: {
        controller: { reference: reference('0'), imageId: image('0') },
        wizard: { reference: reference('6'), imageId: image('6') },
      },
    };
  fs.writeFileSync(
    path.join(f.directory, 'configuration/.release-images.json'),
    JSON.stringify(previous),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(f.directory, 'configuration/.release-images.env'),
    'previous-profile\n',
    { mode: 0o600 },
  );
  const input = {
    operation: 'plan',
    checkout: f.directory,
    persistenceEnv: path.join(f.directory, 'storage.env'),
    directory: path.join(f.directory, 'recovery/public-upgrades/target'),
    repository: 'example/system',
    target: '2.0.0',
    backupFile: path.join(f.directory, 'backup.zip'),
    tokenFile: path.join(f.directory, 'token'),
    gitlabCheckpoint: path.join(f.directory, 'gitlab-checkpoint'),
    timeout: 60,
    backupTimeout: 60,
  };
  const lifecycle = new UpgradeLifecycleService(),
    calls = [],
    sample = { digest: 'unchanged' };
  const accepted = {
    raw: fs.readFileSync(f.input.accepted),
    proofBytes: Buffer.from('frozen-proof'),
    metadata: f.metadata,
    release: f.release,
    evidence: {
      evidence: {
        publicUpgrade: {
          fromVersion: previous.version,
          fromSourceRevision: previous.source.revision,
          fromControllerImageId: image('0'),
          fromWizardImageId: image('6'),
        },
      },
    },
    security: f.input.security,
    graph,
  };
  const host = { ...f.host, rootUser: () => true },
    nativeRun = f.host.runner.run;
  f.host.runner.run = (binary, args, options) =>
    args.includes('info')
      ? { status: 0, stdout: f.directory, stderr: '' }
      : nativeRun(binary, args, options);
  const preparation = {
    inputs: async () => accepted,
    installed: async () => previous,
    verifyHost() {},
    syncIdle: async () => {},
  };
  const backup = {
    target: async (_config, filename) => filename,
    matching: async () => {
      calls.push('backup');
      if (f.backupFailure) throw Error('backup-failed');
      if (f.afterBackup) f.afterBackup();
    },
  };
  const archive = {
    save: async (directory, ref, id, source) => {
      calls.push('archive:' + ref);
      const file = 'images/' + id.slice(7) + '.tar.gz';
      fs.writeFileSync(path.join(directory, file), 'retained', { mode: 0o600 });
      return { file, imageId: id, sha256: bytesSha(Buffer.from('retained')), ...source };
    },
  };
  const controller = {
    publicCandidate: () => ({ ...accepted, evidence: f.input.evidence, authority: f.authority }),
  };
  const plans = new PublicUpgradePlanService({}),
    applies = new PublicUpgradeApplyService(lifecycle, {}),
    prerequisite = { verify: () => ({ checkpoint: input.gitlabCheckpoint, verified: true }) };
  const service = new PublicUpgradeService(
    host,
    f.runtime,
    preparation,
    backup,
    plans,
    applies,
    controller,
    f.service,
    f.native,
    prerequisite,
    lifecycle,
    { verifyCheckout() {} },
    archive,
    { sample: async () => sample },
    {
      connect: () => ({
        get: async () => {
          throw Error('unexpected API');
        },
      }),
    },
  );
  Object.assign(f, {
    publicInput: input,
    publicService: service,
    calls,
    accepted,
    sample,
    plan: () => service.execute(input),
    apply: (confirmation) => service.execute({ ...input, operation: 'apply', confirmation }),
    publicJournal: () => JSON.parse(fs.readFileSync(path.join(input.directory, 'operation.json'))),
  });
  return f;
}
test('public native plan and apply retain independent archives before backup and preserve post-backup health and data gates', async (t) => {
  const f = publicFixture(t),
    plan = await f.plan();
  assert.equal(plan.targetVersion, '2.0.0');
  assert.equal(plan.gitlabPrerequisite.verified, true);
  assert.equal(plan.transitions[0].serviceImagesPreserved, false);
  assert(!fs.existsSync(path.join(f.directory, 'recovery/controller-updates/target')));
  const result = await f.apply(plan.confirmPlanSha256);
  assert.equal(result.phase, 'completed');
  assert(f.calls[0].startsWith('archive:'));
  assert(f.calls[1].startsWith('archive:'));
  assert.equal(f.calls[2], 'backup');
  assert(fs.existsSync(path.join(f.publicInput.directory, 'previous-images.json')));
  assert(fs.existsSync(path.join(f.publicInput.directory, 'post-backup-verification.json')));
  assert.equal(f.rows.system_bootstrapper_1.Image, image('1'));
});
test('public native apply refuses unconfirmed plans before external calls and retains recovery inputs on backup, health, update or sample failures', async (t) => {
  for (const mode of ['confirmation', 'backup', 'health', 'update', 'sample']) {
    const f = publicFixture(t),
      plan = await f.plan();
    if (mode === 'backup') f.backupFailure = true;
    if (mode === 'health')
      f.afterBackup = () => {
        f.failReadiness = true;
        f.native.host.deadline = Date.now();
      };
    if (mode === 'update') f.failCompose = true;
    if (mode === 'sample')
      f.afterBackup = () => {
        f.sample.digest = 'changed';
      };
    const count = f.commands.length;
    await assert.rejects(f.apply(mode === 'confirmation' ? 'wrong' : plan.confirmPlanSha256));
    if (mode === 'confirmation') {
      assert.equal(f.commands.length, count);
      assert.equal(f.calls.length, 0);
    } else {
      assert.equal(f.publicJournal().phase, 'needs-inspection');
      assert(fs.existsSync(path.join(f.publicInput.directory, 'previous-images.json')));
      if (mode !== 'update') assert(!f.commands.some((args) => args[0] === 'stop'));
    }
  }
});
test('public native coordinator lock excludes concurrent attempts without interrupting the active preflight', async (t) => {
  const f = publicFixture(t);
  let unblock;
  const hold = new Promise((resolve) => {
      unblock = resolve;
    }),
    original = f.publicService.data.sample;
  f.publicService.data.sample = async () => {
    await hold;
    return original();
  };
  const first = f.plan();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.publicInput.directory, 'preflight.json'))).phase,
    'checking',
  );
  await assert.rejects(f.plan(), /busy|locked|running|lock/);
  unblock();
  const plan = await first;
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.publicInput.directory, 'preflight.json'))).phase,
    'passed',
  );
  assert.equal(typeof plan.confirmPlanSha256, 'string');
});
test('public authority freezes publisher identity without contacting installation CI and rejects missing gates, failed jobs or cross-attempt images', async () => {
  const {
      PublicUpgradePublicationService,
    } = require('../../dist/modules/testing/public-upgrade-publication.service'),
    {
      HostReleaseAuthorityService,
    } = require('../../dist/modules/host/release-authority.service'),
    { PairedControllerService } = require('../../dist/modules/host/paired-controller.service');
  const input = require('../shared/public-upgrade-fixture').publicationFixture(),
    security = require('../../config/gitlab/security-release.json'),
    root = path.resolve(__dirname, '../..'),
    produced = new PublicUpgradePublicationService({
      verify() {
        throw Error('unexpected checkpoint');
      },
    }).prepare(root, input),
    validator = new HostReleaseAuthorityService({});
  const service = new PairedControllerService(
    undefined,
    undefined,
    validator,
    undefined,
    {
      connect() {
        throw Error('public authority contacted private CI');
      },
    },
    undefined,
  );
  const accepted = service.publicCandidate(produced.metadata, produced.proof, security),
    images = produced.metadata.images;
  assert.equal((await accepted.authority.pipeline()).authority, 'public-github-release');
  await accepted.authority.pair(images.controller.reference, images.wizard.reference);
  produced.metadata.acceptance.candidateJobId++;
  await assert.rejects(accepted.authority.pipeline(), /accepted-inputs-changed/);
  for (const mutate of [
    (proof) => (proof.publication.requiredMergeGate = false),
    (proof) => proof.publication.jobs.pop(),
    (proof) => (proof.publication.jobs[0].status = 'failed'),
    (proof) => proof.publication.jobs[0].pipelineId++,
    (proof) => (proof.release.wizardImageId = image('f')),
  ]) {
    const fresh = new PublicUpgradePublicationService({
        verify() {
          throw Error('unexpected checkpoint');
        },
      }).prepare(root, input),
      proof = JSON.parse(fresh.proof);
    mutate(proof);
    const bytes = Buffer.from(JSON.stringify(proof));
    fresh.metadata.publicUpgrade.sha256 = bytesSha(bytes);
    assert.throws(() => validator.publicInputs(fresh.metadata, bytes, security));
  }
});
function configurationZip(entries) {
  const { crc32 } = require('node:zlib');
  let offset = 0;
  const body = [],
    central = [];
  for (const [name, data] of Object.entries(entries)) {
    const filename = Buffer.from(name),
      raw = Buffer.from(data),
      local = Buffer.alloc(30),
      record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(raw.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt32LE(crc32(raw), 16);
    record.writeUInt32LE(raw.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    body.push(local, filename, raw);
    central.push(record, filename);
    offset += 30 + filename.length + raw.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directory, end]);
}
test('native matching backup verifies real ZIP bytes, completed Seed and exact live configuration before accepting the pair', async (t) => {
  const {
    PublicUpgradeBackupService,
  } = require('../../dist/modules/host/public-upgrade-backup.service');
  for (const mode of [
    'valid',
    'not-completed',
    'manifest',
    'configuration',
    'association',
    'missing-file',
    'hash',
  ]) {
    const f = fixture(t),
      seed = path.join(f.directory, 'seed'),
      target = path.join(f.directory, 'retained'),
      generation = 'snapshot-1',
      operation = 'a'.repeat(32),
      manifest = Buffer.from('completed manifest');
    fs.mkdirSync(path.join(seed, 'snapshots', generation), { recursive: true });
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(seed, 'snapshots', generation, 'manifest.json'), manifest);
    const project = Buffer.from('PRIVATE=exact\n');
    fs.writeFileSync(path.join(f.directory, 'configuration/.projects.env/.app.env'), project, {
      mode: 0o600,
    });
    f.config.SEED_DIR = seed;
    const seedIdentity = {
        status: 'completed',
        generation,
        manifestSha256: bytesSha(manifest),
        gitlabImageId: image('3'),
      },
      association = {
        ...seedIdentity,
        format: 'system-backup-pair-v1',
        status: 'matched-completed-seed',
        verified: true,
        operation,
        configurationFiles: [
          { filename: '.docker.env', sha256: bytesSha(f.raw) },
          { filename: '.projects.env/.app.env', sha256: bytesSha(project) },
        ],
      };
    if (mode === 'association') association.operation = 'b'.repeat(32);
    if (mode === 'missing-file') association.configurationFiles.pop();
    const zip = configurationZip({
        'recovery.json': JSON.stringify({ seed: association }),
        '.docker.env': f.raw,
        '.projects.env/.app.env': project,
      }),
      coordinated = path.join(f.directory, 'configuration/.coordinated-backups', operation);
    fs.mkdirSync(coordinated, { recursive: true });
    fs.writeFileSync(path.join(coordinated, 'bootstrapper.zip'), zip, { mode: 0o600 });
    const status = {
      id: operation,
      state: mode === 'not-completed' ? 'failed' : 'ready',
      helperCompletedAt: 'completed',
      configuration: { status: 'ready', sha256: mode === 'hash' ? 'wrong' : bytesSha(zip) },
      seed: seedIdentity,
    };
    const service = new PublicUpgradeBackupService({}, {});
    service.request = async () => status;
    if (mode === 'manifest')
      fs.writeFileSync(path.join(seed, 'snapshots', generation, 'manifest.json'), 'changed');
    if (mode === 'configuration') fs.appendFileSync(f.config._main, 'CHANGED=1\n');
    const plan = {
      configurationBackup: path.join(f.directory, 'backup.zip'),
      configurationSha256: bytesSha(f.raw),
    };
    if (mode === 'valid') {
      await service.matching(f.config, target, plan, 60);
      assert(fs.readFileSync(plan.configurationBackup).equals(zip));
      assert.equal(fs.statSync(plan.configurationBackup).mode & 0o777, 0o600);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(target, 'backup.json'))).seed.generation,
        generation,
      );
    } else {
      await assert.rejects(service.matching(f.config, target, plan, 60));
      assert(!fs.existsSync(path.join(target, 'backup.json')));
    }
  }
  const f = fixture(t),
    service = new PublicUpgradeBackupService(
      {
        execute: async () => {
          throw Error('missing-backup-medium');
        },
      },
      {},
    );
  f.config.SEED_DIR = '/missing/selected-seed';
  f.config.SEED_MOUNT = '/missing/selected-seed';
  const target = path.join(f.directory, 'fallback/backup.zip');
  await assert.rejects(
    service.target(f.config, target, f.directory, '/selector'),
    /missing-backup-medium/,
  );
  assert(!fs.existsSync(path.dirname(target)));
});
test('native retained-image recovery verifies bytes before loading and creates exact owned aliases without registry access', async (t) => {
  const { RecoveryImageService } = require('../../dist/modules/host/recovery-images'),
    f = fixture(t),
    directory = path.join(f.directory, 'retained');
  fs.mkdirSync(path.join(directory, 'images'), { recursive: true });
  const payload = Buffer.from('immutable save archive'),
    file = 'images/controller-a.tar.gz';
  fs.writeFileSync(path.join(directory, file), payload, { mode: 0o600 });
  const descriptor = { file, sha256: bytesSha(payload), imageId: image('0') },
    expected = { controller: { reference: reference('0'), imageId: image('0') } },
    commands = [],
    aliases = new Map();
  const command = async (args) => {
    commands.push(args);
    if (args[1] === 'inspect') return JSON.stringify([{ Id: aliases.get(args[2]) || args[2] }]);
    if (args[1] === 'tag') aliases.set(args[3], args[2]);
    return '';
  };
  const service = new RecoveryImageService();
  await assert.rejects(
    service.restoreRetained(
      directory,
      { controller: { ...descriptor, sha256: 'f'.repeat(64) } },
      expected,
      command,
    ),
    /archive-changed/,
  );
  assert.equal(commands.length, 0);
  const result = await service.restoreRetained(
    directory,
    { controller: descriptor },
    expected,
    command,
  );
  assert.match(result.controller.reference, /^system-bootstrapper-recovery:[a-f0-9]{64}$/);
  assert.equal(result.controller.originalReference, reference('0'));
  assert(commands.some((args) => args[1] === 'load'));
  assert(!commands.some((args) => args.includes('pull')));
  await assert.rejects(
    service.restoreRetained(directory, { controller: descriptor }, expected, async (args) => {
      if (args[1] === 'ls') throw Error('transport-failed');
      return command(args);
    }),
    /transport-failed/,
  );
});
test('public native apply coordinator excludes a second caller before repeating archives or cold backup', async (t) => {
  const f = publicFixture(t),
    plan = await f.plan();
  let release;
  const hold = new Promise((resolve) => {
      release = resolve;
    }),
    matching = f.publicService.backup.matching;
  f.publicService.backup.matching = async (...args) => {
    await hold;
    return matching(...args);
  };
  const first = f.apply(plan.confirmPlanSha256);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.publicJournal().phase, 'backup-starting');
  const count = f.calls.length;
  await assert.rejects(f.apply(plan.confirmPlanSha256), /busy|locked|running|lock/);
  assert.equal(f.calls.length, count);
  assert.equal(f.publicJournal().phase, 'backup-starting');
  release();
  assert.equal((await first).phase, 'completed');
});
