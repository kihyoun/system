'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { RecoveryImageService, HostInstallService, canonicalDigest } = require('../../dist/modules/host');
const id = (n) => 'sha256:' + n.repeat(64);
function fixture() {
  const manifest = {
    archives: [{ file: 'images/controller.tar.gz', imageId: id('a') }],
    localImages: [
      { tag: 'system_bootstrapper', imageId: id('a') },
      { tag: 'controller:retained', imageId: id('a') },
    ],
    publicImages: [
      { reference: 'nginx:retained@' + id('c'), tag: 'nginx:retained', imageId: id('c') },
    ],
  };
  const calls = [],
    aliases = new Map(manifest.localImages.map((row) => [row.tag, row.imageId]));
  let fail = false;
  const runner = {
    run(binary, args, options) {
      calls.push({ binary, args, options });
      if (fail && args[1] === 'load') throw Error('timeout');
      let stdout = '';
      if (args[1] === 'image' && args[2] === 'inspect') {
        const reference = args.at(-1);
        stdout = JSON.stringify([{ Id: aliases.get(reference) || reference, RepoDigests: [] }]);
        if (reference.startsWith('nginx'))
          stdout = JSON.stringify([{ Id: id('c'), RepoDigests: [canonicalDigest(reference)] }]);
      }
      return { stdout, stderr: '', status: 0 };
    },
  };
  return {
    manifest,
    calls,
    aliases,
    service: new RecoveryImageService(new HostInstallService(runner)),
    fail: () => {
      fail = true;
    },
  };
}
test('archive restore reconstructs exact owned aliases without the private registry', () => {
  const f = fixture();
  f.service.restore('/retained', f.manifest);
  assert.deepEqual(
    new Set(f.calls.filter((c) => c.args[1] === 'tag').map((c) => c.args.at(-1))),
    new Set(['system_bootstrapper', 'controller:retained', 'nginx:retained']),
  );
  assert(!f.calls.some((c) => c.args.includes('pull')));
  assert(f.calls.every((c) => c.binary === 'docker'));
  const load = f.calls.find((c) => c.args[1] === 'load');
  assert.equal(load.options.timeout, 900000);
  assert.deepEqual(load.args.slice(-2), ['--input', '/retained/images/controller.tar.gz']);
  f.aliases.set('controller:retained', id('0'));
  assert.throws(() => f.service.restore('/retained', f.manifest), /local-image-alias-mismatch/);
});
test('failed bounded archive load stops before image verification, aliases or subsequent archives', () => {
  const f = fixture();
  f.fail();
  assert.throws(() => f.service.restore('/retained', f.manifest), /command-failed:docker/);
  assert.equal(f.calls.length, 1);
});
test('recovery transport honors the remaining operation deadline without extending archive limits', () => {
  let timeout;
  const host = new HostInstallService(
    {
      run(binary, args, options) {
        timeout = options.timeout;
        return { stdout: '', stderr: '', status: 0 };
      },
    },
    {},
    undefined,
    undefined,
    Date.now() + 1000,
  );
  host.run('docker', ['load'], undefined, 900000);
  assert(timeout > 0 && timeout <= 1000);
  const expired = new HostInstallService(
    {
      run() {
        assert.fail('expired operation must not spawn');
      },
    },
    {},
    undefined,
    undefined,
    Date.now() - 1,
  );
  assert.throws(() => expired.run('docker', ['load']), /operation-readiness-deadline-expired/);
});
test('native host command timeout terminates its direct process without exposing command output', () => {
  const host = new HostInstallService();
  const started = Date.now();
  assert.throws(
    () =>
      host.run(
        process.execPath,
        ['-e', 'console.error("private-fixture-output"); setTimeout(()=>{},30000)'],
        undefined,
        100,
      ),
    /^HostPolicyError: command-failed:node$/,
  );
  assert(Date.now() - started < 5000);
});

test('native recovery archive publishes complete private bytes and cleans failed exports', async () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    crypto = require('node:crypto');
  const { spawn } = require('node:child_process'),
    { gunzipSync } = require('node:zlib');
  const { RecoveryArchiveService } = require('../../dist/modules/host/recovery-archive.service');
  const { DockerArchiveProcess } = require('../../dist/common/runtime/archive-process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-native-archive-'));
  fs.mkdirSync(path.join(directory, 'images'));
  const source = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)],
    image = id('1');
  const child = (script) =>
    spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const service = new RecoveryArchiveService(
      new DockerArchiveProcess((reference) => {
        assert.equal(reference, image);
        return child('process.stdout.write("fixture image bytes")');
      }),
    );
    const result = await service.save(directory, 'controller:accepted', image, source);
    const filename = path.join(directory, result.file),
      bytes = fs.readFileSync(filename);
    assert.equal(gunzipSync(bytes).toString(), 'fixture image bytes');
    assert.equal(result.bytes, bytes.length);
    assert.equal(result.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    const second = await service.save(directory, 'controller:accepted', image, source);
    assert.notEqual(second.file, result.file);
    assert(fs.existsSync(path.join(directory, second.file)));
    const before = fs.readdirSync(path.join(directory, 'images'));
    for (const script of [
      'process.stdout.write("partial");process.exitCode=7',
      'process.stdout.end();process.exitCode=1',
    ]) {
      const failing = new RecoveryArchiveService(new DockerArchiveProcess(() => child(script)));
      await assert.rejects(
        failing.save(directory, 'controller:accepted', image, source),
        /archive-failed/,
      );
      assert.deepEqual(fs.readdirSync(path.join(directory, 'images')), before);
    }
    const cancel = new AbortController();
    let launched;
    const waiting = new RecoveryArchiveService(
      new DockerArchiveProcess(() => {
        launched = child('setInterval(()=>process.stdout.write("chunk"),10)');
        setTimeout(() => cancel.abort(), 60);
        return launched;
      }),
    );
    await assert.rejects(
      waiting.save(directory, 'controller:accepted', image, source, cancel.signal),
      /archive-failed/,
    );
    assert.equal(launched.signalCode, 'SIGKILL');
    assert.deepEqual(fs.readdirSync(path.join(directory, 'images')), before);
    const absent = new RecoveryArchiveService(
      new DockerArchiveProcess(() =>
        spawn('/nonexistent-bootstrapper-test-binary', [], { stdio: ['ignore', 'pipe', 'ignore'] }),
      ),
    );
    await assert.rejects(
      absent.save(directory, 'controller:accepted', image, source),
      /archive-failed/,
    );
    assert.deepEqual(fs.readdirSync(path.join(directory, 'images')), before);
    // The export use case owns the same durable lease through asynchronous archive completion.
    const { RecoveryExportService } = require('../../dist/modules/host/recovery-export.service');
    const calls = [],
      main = path.join(directory, 'main'),
      manifest = path.join(directory, 'images.json');
    fs.writeFileSync(main, 'saved');
    fs.writeFileSync(manifest, '{}', { mode: 0o600 });
    const root = path.dirname(directory),
      config = {
        _root: root,
        _main: main,
        SEED_DIR: '',
        BOOTSTRAPPER_IMAGE: 'system-successor:' + source[0] + '-job12',
        GITLAB_IMAGE: 'gitlab@' + id('2'),
        GITLAB_RUNNER_IMAGE: 'runner@' + id('3'),
        WIZARD_IMAGE: 'wizard:retained',
        GITLAB_RUNNER_SCALE: '1',
      };
    // Use an isolated retained directory with the production name.
    const retained = path.join(root, 'recovery-export-' + process.pid);
    fs.mkdirSync(retained);
    fs.renameSync(directory, path.join(retained, 'recovery'));
    config._root = retained;
    config._main = path.join(retained, 'recovery', 'main');
    let failArchive = false,
      failValidation = false;
    const controller = {
      Image: id('1'),
      State: { Running: true },
      Config: {
        Labels: {
          'com.docker.compose.project': 'system',
          'com.docker.compose.service': 'bootstrapper',
        },
      },
    };
    const host = {
      source: () => ({
        sourceCommit: source[0],
        sourceTree: source[1],
        wizardSourceRevision: source[2],
      }),
      run: (_binary, args) => {
        calls.push('inspect');
        return JSON.stringify([
          args.at(-1) === 'system_bootstrapper_1'
            ? controller
            : { Image: id('2'), State: { Running: true } },
        ]);
      },
    };
    const exported = new RecoveryExportService(
      host,
      { verifyCheckout() {} },
      {
        load: (...args) => {
          if (failValidation && args[4] !== undefined) throw Error('invalid candidate');
          return {};
        },
        validateSelected() {
          calls.push('validate');
        },
      },
      {
        inspect: (reference) => ({
          Id: reference.startsWith('gitlab')
            ? id('2')
            : reference.startsWith('runner')
              ? id('3')
              : id('1'),
          RepoDigests: [reference],
        }),
      },
      {
        save: async () => {
          calls.push('archive-start');
          await new Promise((resolve) => setImmediate(resolve));
          if (failArchive) throw Error('archive refused');
          calls.push('archive-end');
          return { file: 'images/retained.tar.gz' };
        },
      },
      { refresh: () => ({ currentController: {} }) },
      { inspect: () => ({ runner_docker_1: { Image: id('3') } }), mounts() {} },
      {
        acquire() {
          calls.push('acquire');
        },
        finish(failed) {
          calls.push(failed ? 'failed' : 'released');
        },
      },
      {
        syncIdle: async () => {
          calls.push('idle');
        },
      },
    );
    const release = {
        sourceRevision: source[0],
        candidateJobId: 12,
        imageId: id('1'),
        registryReference: 'controller@' + id('1'),
      },
      evidence = {
        evidence: {
          gitlabUpgrade: {
            toImageId: id('2'),
            toImage: config.GITLAB_IMAGE,
            runnerImage: config.GITLAB_RUNNER_IMAGE,
            runnerImageId: id('3'),
          },
        },
      };
    try {
      const result = await exported.record(
        config,
        release,
        evidence,
        '/checkout',
        path.join(retained, 'result.json'),
      );
      assert.equal(result.savedConfigurationUnchanged, true);
      assert.equal(calls.at(-1), 'released');
      assert(calls.indexOf('acquire') < calls.indexOf('inspect'));
      assert(calls.indexOf('archive-end') < calls.indexOf('validate'));
      assert(
        fs.existsSync(
          path.join(
            retained,
            'recovery',
            'manifest-history',
            'images-' + crypto.createHash('sha256').update('{}').digest('hex') + '.json',
          ),
        ),
      );
      const published = fs.readFileSync(path.join(retained, 'recovery', 'images.json'));
      failArchive = true;
      await assert.rejects(
        exported.record(config, release, evidence, '/checkout', path.join(retained, 'result.json')),
        /archive refused/,
      );
      assert.equal(calls.at(-1), 'failed');
      assert.deepEqual(fs.readFileSync(path.join(retained, 'recovery', 'images.json')), published);
      failArchive = false;
      failValidation = true;
      // Exercise candidate publication validation directly, preserving existing bytes and history.
      await assert.rejects(
        exported.record(config, release, evidence, '/checkout', path.join(retained, 'result.json')),
        /invalid candidate/,
      );
      assert.deepEqual(fs.readFileSync(path.join(retained, 'recovery', 'images.json')), published);
    } finally {
      fs.renameSync(path.join(retained, 'recovery'), directory);
      fs.rmSync(retained, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('recovery operation shares offline authority and refuses legacy loading before I/O', async () => {
  const { NestFactory } = require('@nestjs/core');
  const { HostModule, RecoveryOperationService, RecoveryManifestService, RecoveryImageService } = require('../../dist/modules/host');
  const { parseRecoveryInput } = require('../../dist/modules/host/recovery-entry');
  const input = parseRecoveryInput(['load', '--directory', '/retained', '--checkout', '/source', '--configuration', '/saved/main.sh']);
  const app = await NestFactory.createApplicationContext(HostModule.register(), { logger: false });
  const calls = [], manifest = { archives: [] };
  try {
    const manifests = app.get(RecoveryManifestService), images = app.get(RecoveryImageService);
    manifests.load = (...args) => { calls.push(['load', ...args]); return manifest; };
    manifests.validateSelected = (value, filename) => { assert.equal(value, manifest); calls.push(['selected', filename]); };
    images.restore = (directory, value) => { assert.equal(value, manifest); calls.push(['restore', directory]); };
    const service = app.get(RecoveryOperationService);
    assert.throws(() => service.execute({ ...input, checksumsOnly: true }), /legacy-checksums-cannot-load-images/);
    assert.throws(() => service.execute({ ...input, operation: 'verify', checksumsOnly: true }), /legacy-checksums-cannot-validate-configuration/);
    assert.deepEqual(calls, []);
    assert.equal(service.execute(input), 'loaded');
    assert.deepEqual(calls.map(row => row[0]), ['load', 'selected', 'restore']);
    calls.length = 0;
    manifests.validateSelected = () => { throw Error('selector-mismatch'); };
    assert.throws(() => service.execute(input), /selector-mismatch/);
    assert.deepEqual(calls.map(row => row[0]), ['load']);
    calls.length = 0;
    assert.equal(service.execute({ ...input, operation: 'verify', configuration: undefined, checksumsOnly: true }), 'verified');
    assert.equal(calls[0][4], true);
    assert.equal(calls.length, 1);
    for (const args of [[], ['verify', 'load'], ['unknown'], ['verify', '--directory', '/retained']]) assert.throws(() => parseRecoveryInput(args));
  } finally { await app.close(); }
});
