const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { fixture, image, reference } = require('./paired-native-fixture.cjs');
test('native controller-only and paired update preserve core state, exact selectors, checkpoints and rollback', async (t) => {
  for (const paired of [false, true]) {
    const f = fixture(t, { paired });
    const result = await f.update();
    assert.equal(result.phase, 'completed');
    assert.equal(result.serviceImagesPreserved, !paired);
    assert.equal(result.databaseRewound, false);
    assert.equal(f.events.at(-1), 'finish:false');
    const after = fs.readFileSync(f.config._main);
    assert(after.subarray(0, 1184).equals(f.raw.subarray(0, 1184)));
    assert(after.includes(reference('1')));
    assert(after.includes(reference(paired ? '2' : '6')));
    assert.equal(f.rows.system_gitlab_1.Image, image('3'));
    assert.equal(f.rows.runner_docker_2.Image, image('4'));
    assert.equal((await f.rollback()).phase, 'rolled-back');
    assert(fs.readFileSync(f.config._main).equals(f.raw));
    assert.equal(f.rows.system_bootstrapper_1.Image, image('0'));
    assert.equal(f.rows.system_wizard_1.Image, image('6'));
    assert(
      f.commands.some((args) => args[0] === 'update' && args[1] === '--restart=unless-stopped'),
    );
  }
});
test('native preflight has no checkpoint or service mutation and refuses changed authority, images and peers', async (t) => {
  const cases = [
    ['check', () => {}, null],
    ['image', (f) => (f.badImage = true), /accepted-candidate/],
    ['job', (f) => (f.badJob = true), /accepted-candidate/],
    ['pipeline', (f) => (f.failPipeline = true), /merge-gate/],
    ['source', (f) => (f.sourceChanged = true), /source-checkout/],
    ['manifest', (f) => (f.manifest = true), /archive-manifest/],
    ['gitlab', (f) => (f.rows.system_gitlab_1.Image = image('9')), /current-GitLab/],
    ['runner', (f) => (f.rows.runner_docker_2.Image = image('9')), /current-runner/],
    ['jobs', (f) => (f.probe.runningJobs = 1), /jobs-or-migrations/],
    ['migrations', (f) => (f.probe.unfinishedBackgroundMigrations = 1), /jobs-or-migrations/],
    ['mount', (f) => (f.mountChanged = true), /mount-changed/],
    ['sync', (f) => (f.syncBusy = true), /sync-operation/],
  ];
  for (const [, change, error] of cases) {
    const f = fixture(t);
    change(f);
    if (error) await assert.rejects(f.update({ checkOnly: true }), error);
    else assert.equal((await f.update({ checkOnly: true })).phase, 'preflight-passed');
    assert(!fs.existsSync(f.input.checkpoint));
    assert(!f.commands.some((args) => ['stop', 'update', 'compose'].includes(args[0])));
    assert(fs.readFileSync(f.config._main).equals(f.raw));
  }
});
test('paired publication and selector drift are rechecked under the owner before stopping', async (t) => {
  for (const kind of ['pair', 'selection', 'foreign-wizard', 'disabled']) {
    const f = fixture(t, { selected: true });
    if (kind === 'pair') f.changedPair = true;
    if (kind === 'foreign-wizard')
      f.rows.system_wizard_1.Config.Labels['com.docker.compose.project'] = 'foreign';
    if (kind === 'disabled') f.config.WIZARD_ENABLE = 'false';
    if (kind === 'selection') {
      const pipeline = f.authority.pipeline;
      let count = 0;
      f.authority.pipeline = async () => {
        const value = await pipeline();
        if (++count === 2)
          fs.writeFileSync(path.join(f.directory, 'configuration/.release-images.env'), 'foreign', {
            mode: 0o600,
          });
        return value;
      };
    }
    await assert.rejects(f.update());
    assert(!f.commands.some((args) => args[0] === 'stop'));
    assert(fs.readFileSync(f.config._main).equals(f.raw));
  }
});
test('native selection publication restores initially absent receipts and detects retained drift', async (t) => {
  const f = fixture(t, { selected: true });
  await f.update();
  assert(fs.existsSync(path.join(f.directory, 'configuration/.release-images.json')));
  assert.equal((await f.rollback()).phase, 'rolled-back');
  assert(!fs.existsSync(path.join(f.directory, 'configuration/.release-images.json')));
  const changed = fixture(t, { selected: true });
  await changed.update();
  fs.writeFileSync(path.join(changed.input.checkpoint, '.release-images.json.after'), 'corrupt');
  changed.commands.length = 0;
  await assert.rejects(changed.rollback());
  assert(!changed.commands.some((args) => args[0] === 'stop'));
});
test('interrupted start retains the owned checkpoint and rollback requires unchanged configuration and proven container absence', async (t) => {
  const f = fixture(t, { paired: true });
  f.failCompose = true;
  await assert.rejects(f.update(), /command-failed/);
  assert.equal(f.journal().phase, 'controller-start-started');
  assert(f.retained);
  f.failCompose = false;
  delete f.rows.system_bootstrapper_1;
  delete f.rows.system_wizard_1;
  f.failList = true;
  await assert.rejects(f.rollback(), /command-failed/);
  f.failList = false;
  assert.equal((await f.rollback()).phase, 'rolled-back');
  assert(fs.readFileSync(f.config._main).equals(f.raw));
  const changed = fixture(t);
  await changed.update();
  fs.appendFileSync(changed.config._main, 'CHANGED=1\n');
  changed.commands.length = 0;
  await assert.rejects(changed.rollback(), /configuration-changed/);
  assert.equal(changed.commands.length, 0);
});
test('stopped repair preserves failed code as stopped on rollback and refuses ambiguous states', async (t) => {
  const f = fixture(t, { stopped: true });
  assert.equal((await f.update({ checkOnly: true })).phase, 'preflight-passed');
  assert.equal(f.readiness, 0);
  assert.equal(f.rows.system_bootstrapper_1.State.Running, false);
  assert(!fs.existsSync(f.input.checkpoint));
  await f.update();
  assert.equal(f.readiness, 1);
  const rollbackStart = f.commands.length;
  assert.equal((await f.rollback()).phase, 'rolled-back-stopped');
  assert.equal(f.rows.system_bootstrapper_1.State.Running, false);
  assert(
    !f.commands
      .slice(rollbackStart)
      .some(
        (args) => args[0] === 'compose' && args.includes('up') && args.at(-1) === 'bootstrapper',
      ),
  );
  for (const mutation of [
    (state) => (state.Running = true),
    (state) => (state.ExitCode = 137),
    (state) => (state.Pid = 123),
    (state) => (state.OOMKilled = true),
  ]) {
    const invalid = fixture(t, { stopped: true });
    mutation(invalid.rows.system_bootstrapper_1.State);
    await assert.rejects(invalid.update(), /quiescent/);
    assert(!fs.existsSync(invalid.input.checkpoint));
  }
});
test('interruption awaits the owned command and prevents all subsequent mutations while retaining critical recovery state', async (t) => {
  const f = fixture(t),
    controller = new AbortController(),
    owned = f.lease.command;
  let settled = false;
  f.lease.command = async (...args) => {
    const value = await owned(...args);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    settled = true;
    return value;
  };
  await assert.rejects(f.update({ signal: controller.signal }), /host-operation-interrupted/);
  assert(settled);
  assert(f.retained);
  assert.equal(f.journal().phase, 'controller-stop-started');
  assert(fs.readFileSync(f.config._main).equals(f.raw));
  assert(!f.commands.some((args) => args[0] === 'stop' || args[0] === 'compose'));
  const before = fixture(t);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(before.update({ signal: aborted.signal }), /host-operation-interrupted/);
  assert(!fs.existsSync(before.input.checkpoint));
  assert.equal(before.commands.length, 0);
});
test('stopped repair refuses active peers, foreign operations and owned guardian children before checkpoint publication', async (t) => {
  for (const change of [
    (f) => (f.rows.system_wizard_1.State.Health = { Status: 'unhealthy' }),
    (f) => (f.rows.runner_docker_2.ExecIDs = ['provisioning']),
    (f) => delete f.rows.system_wizard_1.ExecIDs,
    (f) => (f.rows.system_wizard_1.Config.Labels['com.docker.compose.project'] = 'foreign'),
    (f) => fs.mkdirSync(path.join(f.directory, 'configuration/.storage-operation-lock')),
    (f) => {
      f.lease.describe = () => ({
        held: [path.join(f.directory, 'configuration/.gitlab-upgrade-lock')],
      });
      f.foreignChild = true;
    },
    (f) => (f.mountChanged = true),
  ]) {
    const f = fixture(t, { stopped: true });
    change(f);
    await assert.rejects(f.update());
    assert(!fs.existsSync(f.input.checkpoint));
    assert(!f.commands.some((args) => ['update', 'stop', 'compose'].includes(args[0])));
  }
  const failed = fixture(t, { stopped: true });
  failed.failReadiness = true;
  await assert.rejects(failed.update(), /readiness-failed/);
  assert.equal(failed.journal().phase, 'controller-start-started');
  assert(failed.retained);
  failed.failReadiness = false;
  assert.equal((await failed.rollback()).phase, 'rolled-back-stopped');
});
test('rollback rejects unrelated images, retargeted retained selectors and changed stopped runner identity before mutation', async (t) => {
  for (const mode of ['wizard', 'previous', 'binding', 'runner']) {
    const f = fixture(t, { paired: true, stopped: mode === 'runner' });
    await f.update();
    if (mode === 'wizard') f.rows.system_wizard_1.Image = image('9');
    if (mode === 'previous') f.service.images.inspect = () => ({ Id: image('9') });
    if (mode === 'binding') f.bindingChanged = true;
    if (mode === 'runner') f.rows.runner_docker_2.Id = 'changed';
    f.commands.length = 0;
    await assert.rejects(f.rollback());
    assert(!f.commands.some((args) => ['update', 'stop', 'compose'].includes(args[0])));
  }
  const f = fixture(t, { stopped: true });
  await f.update();
  const owned = f.lease.command;
  f.lease.command = async (...args) => {
    const result = await owned(...args);
    if (args[0].includes('stop')) f.rows.runner_docker_2.ExecIDs = ['new-provisioner'];
    return result;
  };
  await assert.rejects(f.rollback(), /active-or-unknown-execs/);
  assert(fs.readFileSync(f.config._main).includes(reference('1')));
});
