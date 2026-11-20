const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'),
  dist = path.join(root, 'operations/dist');
const { PairedUpdateService } = require(dist + '/host/paired-update.service'),
  { PairedRuntimeService } = require(dist + '/host/paired-runtime.service'),
  { ReleaseSelectionService, bytesSha } = require(dist + '/host/release-selection.service'),
  { ControllerUpdateSequenceService } = require(dist + '/host/controller-update-sequence.service'),
  { ControllerRollbackSequenceService } = require(
    dist + '/host/controller-rollback-sequence.service',
  ),
  { HostPolicyError, requireValue: ensure } = require(dist + '/host/install'),
  { environmentAssignments } = require(dist + '/runtime/environment-assignments');
const image = (value) => 'sha256:' + value.repeat(64),
  reference = (value) => 'docker.io/example/system@' + image(value);
function fixture(t, { paired = false, selected = false, stopped = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'configuration/.projects.env'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'VERSION'), '2.0.0\n');
  const config = {
      _root: directory,
      _main: path.join(directory, 'configuration/.docker.env'),
      BOOTSTRAPPER_IMAGE: reference('0'),
      WIZARD_IMAGE: reference('6'),
      WIZARD_ENABLE: 'true',
      GITLAB_RUNNER_SCALE: '2',
      GITLAB_HOST: 'gitlab.example.invalid',
      GITLAB_DOMAIN_MODE: '0',
      SEED_DIR: '',
    },
    commands = [],
    events = [];
  const raw = Buffer.concat([
    fs.readFileSync(path.join(root, 'system/.docker.env.example')).subarray(0, 1184),
    Buffer.from(
      '\n' +
        Object.entries(config)
          .filter(([key]) => !key.startsWith('_'))
          .map(([key, value]) => `export ${key}='${value}'\n`)
          .join(''),
    ),
  ]);
  fs.writeFileSync(config._main, raw, { mode: 0o600 });
  const release = {
    sourceRevision: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    wizardRevision: 'c'.repeat(40),
    imageId: image('1'),
    wizardImageId: image('2'),
    candidateJobId: 12,
    candidateEvidenceSha256: 'e'.repeat(64),
  };
  const row = (name, value) => ({
    Name: '/' + name,
    Id: value.repeat(64),
    Image: image(value),
    Config: {
      Labels: {
        'com.docker.compose.project': name.startsWith('runner_') ? 'runner' : 'system',
        'com.docker.compose.service': name.startsWith('runner_')
          ? name.slice(7)
          : name.split('_')[1],
      },
    },
    State: {
      Status: 'running',
      Pid: 100,
      Running: true,
      Paused: false,
      Restarting: false,
      Dead: false,
      OOMKilled: false,
      ExitCode: 0,
    },
    ExecIDs: [],
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
  });
  const rows = {
    system_bootstrapper_1: row('system_bootstrapper_1', '0'),
    system_gitlab_1: row('system_gitlab_1', '3'),
    system_wizard_1: row('system_wizard_1', '6'),
    runner_docker_1: row('runner_docker_1', '4'),
    runner_docker_2: row('runner_docker_2', '5'),
  };
  rows.runner_docker_2.Image = image('4');
  if (stopped) {
    Object.assign(rows.system_bootstrapper_1.State, {
      Status: 'exited',
      Pid: 0,
      Running: false,
      ExitCode: 1,
    });
    rows.system_bootstrapper_1.HostConfig.RestartPolicy.Name = 'no';
  }
  const f = {
    directory,
    config,
    raw,
    rows,
    commands,
    events,
    release,
    failCompose: false,
    failReadiness: false,
    foreignChild: false,
    failPipeline: false,
    changedPair: false,
    readiness: 0,
    probe: { version: '19.6.1', edition: 'CE', runningJobs: 0, unfinishedBackgroundMigrations: 0 },
  };
  const selection = () =>
    Object.fromEntries(
      Object.entries(rows).map(([name, row]) => [
        name,
        {
          imageId: row.Image,
          reference:
            name === 'system_bootstrapper_1'
              ? config.BOOTSTRAPPER_IMAGE
              : name === 'system_wizard_1'
                ? config.WIZARD_IMAGE
                : row.Image,
        },
      ]),
    );
  const snapshot = () => ({
    selectedImages: selection(),
    configurationFiles: { 'configuration/.docker.env': bytesSha(fs.readFileSync(config._main)) },
    runnerManagerIdentitySha256: { first: 'one', second: 'two' },
    sourceCommit: release.sourceRevision,
    sourceTree: release.sourceTree,
  });
  const runtime = {
    manifestAbsent() {
      ensure(!f.manifest, 'archive-manifest-present');
    },
    settings: async () => {
      Object.assign(config, environmentAssignments(fs.readFileSync(config._main, 'utf8')));
      return config;
    },
    services: () => structuredClone(rows),
    publicImages: () => selection(),
    capture: snapshot,
    assertBaseline(_config, value) {
      ensure(
        value.configurationFiles['configuration/.docker.env'] ===
          bytesSha(fs.readFileSync(config._main)),
        'configuration-changed',
      );
      ensure(!f.bindingChanged, 'canonical-binding-changed');
    },
    managementRoutes: async () => {},
    verify: async (_config, baseline) => {
      f.readiness++;
      if (f.failReadiness) throw new HostPolicyError('service-not-healthy');
      assert.equal(rows.system_bootstrapper_1.State.Running, true);
      for (const [name, value] of Object.entries(baseline.selectedImages))
        ensure(rows[name]?.Image === value.imageId, 'selected-image-changed');
      return { runnerManagers: { checked: true } };
    },
  };
  function command(argv, _timeout, _stdin, env) {
    const args = argv[0] === 'docker' ? argv.slice(2) : argv.slice(1);
    commands.push(args);
    const byId = (id) => Object.values(rows).find((row) => row.Id === id);
    if (args[0] === 'inspect') return JSON.stringify([rows[args[1]] || byId(args[1])]);
    if (args[0] === 'container' && args[1] === 'ls') {
      if (f.failList) throw new HostPolicyError('command-failed:docker');
      const name = args[args.indexOf('--filter') + 1].slice(7, -1);
      return rows[name] ? name + '\n' : '';
    }
    if (args[0] === 'stop') {
      const row = byId(args.at(-1));
      row.State.Running = false;
      row.State.Pid = 0;
    }
    if (args[0] === 'compose') {
      if (f.failCompose) throw new HostPolicyError('command-failed:docker');
      const create = args.includes('create'),
        onlyWizard = args.at(-1) === 'wizard';
      if (!onlyWizard) {
        const ref = env?.BOOTSTRAPPER_IMAGE || config.BOOTSTRAPPER_IMAGE;
        rows.system_bootstrapper_1 = row(
          'system_bootstrapper_1',
          ref === reference('0') ? '0' : '1',
        );
        if (create) {
          Object.assign(rows.system_bootstrapper_1.State, {
            Status: 'created',
            Running: false,
            Pid: 0,
          });
          rows.system_bootstrapper_1.HostConfig.RestartPolicy.Name = 'no';
        }
      }
      if (!create)
        rows.system_wizard_1 = row(
          'system_wizard_1',
          environmentAssignments(fs.readFileSync(config._main, 'utf8')).WIZARD_IMAGE ===
            reference('6')
            ? '6'
            : '2',
        );
    }
    return '';
  }
  const lease = {
    operation: 'owned-attempt',
    critical: false,
    acquire() {
      events.push('acquire');
      ensure(!f.held, 'busy');
      f.held = true;
    },
    adopt(_value, id) {
      events.push('adopt:' + id);
      f.held = true;
    },
    describe: () => ({ held: [] }),
    assertIdle() {
      ensure(!f.foreignChild, 'guarded-child-active');
    },
    command: async (...args) => Buffer.from(command(...args)),
    finish(failed) {
      events.push('finish:' + failed);
      f.held = false;
      f.retained = failed && lease.critical;
    },
  };
  const host = {
    environment: {},
    image(ref, _source, wizard) {
      return {
        reference: ref,
        imageId: f.badImage ? 'wrong' : wizard ? release.wizardImageId : release.imageId,
        candidateJobId: f.badJob ? 999 : 12,
      };
    },
    runner: {
      run(binary, args, options) {
        return { status: 0, stdout: command(args, 0, options.input, options.env), stderr: '' };
      },
    },
  };
  const preparation = {
    syncIdle: async () => {
      events.push('sync-idle');
      ensure(!f.syncBusy, 'sync-operation-active');
    },
  };
  const native = new PairedRuntimeService(
    host,
    runtime,
    {
      mounts() {
        ensure(!f.mountChanged, 'mount-changed');
      },
    },
    lease,
    { probe: async () => f.probe },
    preparation,
  );
  const source = {
      verifyCheckout() {
        ensure(!f.sourceChanged, 'source-checkout-mismatch');
      },
    },
    authority = {
      evidenceSha256: release.candidateEvidenceSha256,
      pipeline: async () => {
        events.push('pipeline');
        ensure(!f.failPipeline, 'merge-gate-disabled');
        return { accepted: true };
      },
      pair: async () => {
        events.push('pair');
        return {
          accepted: f.changedPair && events.filter((x) => x === 'pair').length > 1 ? false : true,
        };
      },
    };
  const service = new PairedUpdateService(
    host,
    source,
    runtime,
    native,
    new ReleaseSelectionService(),
    {
      inspect: (ref) => ({
        Id: ref === reference('0') ? image('0') : ref === reference('6') ? image('6') : 'wrong',
      }),
    },
    preparation,
    new ControllerUpdateSequenceService({}),
    new ControllerRollbackSequenceService({}),
  );
  const input = {
    config,
    release,
    evidence: { evidence: { gitlabUpgrade: { toImageId: image('3'), runnerImageId: image('4') } } },
    security: { toVersion: '19.6.1' },
    authority,
    controller: reference('1'),
    ...(paired || selected || stopped ? { wizard: reference('2') } : {}),
    checkout: directory,
    persistenceEnv: path.join(directory, 'storage.env'),
    tokenFile: path.join(directory, 'token'),
    timeout: 0,
    checkpoint: path.join(directory, 'recovery/controller-updates/attempt'),
    ...(stopped ? { repairStoppedController: true } : {}),
  };
  if (selected || stopped) {
    const metadata = {
      format: 'system-accepted-release-v1',
      version: '2.0.0',
      tag: 'v2.0.0',
      platform: 'linux/amd64',
      source: {
        revision: release.sourceRevision,
        tree: release.sourceTree,
        wizardRevision: release.wizardRevision,
      },
      images: Object.fromEntries(
        [
          ['controller', '1'],
          ['wizard', '2'],
        ].map(([role, value]) => [
          role,
          { reference: reference(value), imageId: image(value), configDigest: image(value) },
        ]),
      ),
      acceptance: {
        candidateJobId: 12,
        evidenceSha256: release.candidateEvidenceSha256,
        controllerWizardSameAttempt: true,
        requiredChecksPassed: true,
      },
    };
    f.metadata = metadata;
    input.accepted = path.join(directory, 'accepted.json');
    fs.writeFileSync(input.accepted, JSON.stringify(metadata), { mode: 0o600 });
  }
  Object.assign(f, {
    input,
    service,
    native,
    lease,
    host,
    runtime,
    authority,
    update: (extra) => service.update({ ...input, ...extra }),
    rollback: () => service.rollback(input),
    journal: () => JSON.parse(fs.readFileSync(path.join(input.checkpoint, 'operation.json'))),
  });
  return f;
}
module.exports = { fixture, image, reference };
