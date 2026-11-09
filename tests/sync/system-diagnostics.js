'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('../../sync/node_modules/express');
const {checkRegistry, configuredRegistry, registerSystemDiagnostics} = require('../../sync/dist/SystemDiagnostics');
const {inspectRunner, validHelperImage} = require('../../sync/dist/SystemDiagnosticsDocker');
const {nativeProbe} = require('../../sync/dist/SystemDiagnosticsProbe');
const http = require('node:http');
const image = 'registry.example.test/runner/helper:x86_64-v1@sha256:' + 'a'.repeat(64);
const targets = {registry: 'https://registry.example.test:5443', helper: 'https://helper.example.test', helperImage: image,
  runners: ['runner_docker_1'], context: 'controller'};
function driver(fail) {
  const calls = [];
  const action = (name, value) => async () => {
    calls.push(name);
    if (fail === name) throw Object.assign(new Error('token=must-not-leak'), {code: name === 'dns' ? 'ENOTFOUND' : name === 'tcp' ? 'ETIMEDOUT' : 'CERT_HAS_EXPIRED'});
    return value;
  };
  return {calls, dns: action('dns', ['192.0.2.1']), tcp: action('tcp'), tls: action('tls'),
    http: action('http', {status: 401, challenge: true})};
}
for (const [failure, step, code] of [['dns', 0, 'ENOTFOUND'], ['tcp', 1, 'ETIMEDOUT'], ['tls', 2, 'CERT_HAS_EXPIRED']]) {
  test(failure + ' failure has distinct code and skips dependents', async () => {
    const probe = driver(failure), result = await checkRegistry(targets.registry, probe);
    assert.equal(result.steps[step].status, 'failed'); assert.equal(result.steps[step].code, code);
    assert(result.steps.slice(step + 1).every(item => item.status === 'not-checked' && item.durationMs === 0));
    assert.equal(probe.calls.length, step + 1);
    assert(!JSON.stringify(result).includes('must-not-leak'));
    assert(result.context.includes('does not establish runner'));
  });
}
test('401 challenge means reachable without credential or image proof', async () => {
  const result = await checkRegistry(targets.registry, driver());
  assert(result.steps.every(item => item.status === 'passed'));
  assert.equal(result.steps[3].code, 'HTTP_401_CHALLENGE');
  assert(result.steps[3].detail.includes('remain unverified'));
});
for (const status of [301, 401, 403, 404, 500]) test('HTTP ' + status + ' without challenge is distinct', async () => {
  const probe = driver(); probe.http = async () => ({status, challenge: false});
  const result = await checkRegistry(targets.registry, probe);
  assert.equal(result.steps[3].status, 'failed'); assert.equal(result.steps[3].code, 'HTTP_' + status);
});
test('HTTP port preserved, TLS intentionally skipped and registry marker required for 200', async () => {
  const probe = driver(); probe.http = async url => {assert.equal(url.port, '5055'); return {status: 200, registry: true};};
  const result = await checkRegistry('http://registry.example.test:5055', probe);
  assert.equal(result.steps[2].code, 'HTTP_CONFIGURED'); assert(!probe.calls.includes('tls'));
  assert.equal(result.steps[3].code, 'HTTP_200_REGISTRY');
  probe.http = async () => ({status: 200, registry: false});
  assert.equal((await checkRegistry(targets.registry, probe)).steps[3].status, 'failed');
});
test('configured private registry is permitted; URL credentials, paths and schemes are rejected', () => {
  assert.equal(configuredRegistry('https://10.0.0.1:5443').port, '5443');
  for (const value of ['file:///etc/passwd', 'https://user:secret@example.test', 'http://example.test/path', 'http://example.test/?token=secret', 'http://example.test/#foo']) assert.throws(() => configuredRegistry(value));
});
test('native HTTP reports redirect without following its target or reading bodies', async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {requests++; res.writeHead(302, {Location: 'http://127.0.0.1:1/private?token=must-not-leak'}); res.end('must-not-leak');});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await nativeProbe.http(new URL('http://localhost:' + server.address().port), '127.0.0.1');
    assert.equal(result.status, 302); assert.equal(requests, 1); assert(!JSON.stringify(result).includes('must-not-leak'));
  } finally {await new Promise(resolve => server.close(resolve));}
});
const runnerConfig = '[[runners]]\nexecutor = "docker"\ntoken = "must-not-leak"\n[runners.docker]\nhelper_image = "' + image + '"\n';
const runnerRow = {Name: '/runner_docker_1', State: {Running: true}, Config: {Env: ['SECRET=must-not-leak']},
  Mounts: [{Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock'}]};
function inspectFixture(content = runnerConfig, row = runnerRow) {
  const calls = [];
  return {calls, read: async args => {calls.push(args); return args[0] === 'container' ? JSON.stringify([row]) : content;}};
}
test('pull context verifies actual selected runner socket and exact immutable helper image', async () => {
  const fixture = inspectFixture(); const context = await inspectRunner('runner_docker_1', fixture.read);
  assert.equal(context.image, image); assert.equal(context.auth, ''); assert(!JSON.stringify(context).includes('must-not-leak'));
  assert.deepEqual(fixture.calls[1], ['exec', 'runner_docker_1', 'cat', '/etc/gitlab-runner/config.toml']);
  assert(validHelperImage(image)); assert(!validHelperImage(image.split('@')[0]));
});
for (const [description, content, row] of [
  ['remote daemon', runnerConfig + 'host = "tcp://another-daemon:2375"\n'],
  ['missing helper', runnerConfig.replace(/^helper_image.*\n/m, '')],
  ['multiple registrations', runnerConfig + '[[runners]]\n'],
  ['credential environment', runnerConfig + 'environment = ["DOCKER_AUTH_CONFIG=must-not-leak"]\n'],
  ['foreign socket', runnerConfig, {...runnerRow, Mounts: []}]
]) test('fails closed for ' + description, async () => {
  await assert.rejects(inspectRunner('runner_docker_1', inspectFixture(content, row).read));
});
async function fixture(deps, work) {
  const app = express(); app.use(express.json());
  registerSystemDiagnostics(app, (req, res, next) => req.headers.authorization === 'Bearer fixture' ? next() : res.sendStatus(401), deps);
  const server = await new Promise(resolve => {const value = app.listen(0, '127.0.0.1', () => resolve(value));});
  const request = async (endpoint, body, authenticated = true) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/diagnostics' + endpoint,
      {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', ...(authenticated ? {Authorization: 'Bearer fixture'} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, cache: response.headers.get('cache-control'), text: await response.text()};
  };
  try {await work(request);} finally {await new Promise(resolve => server.close(resolve));}
}
const deps = {targets: async () => targets, probe: driver(), inspect: async () => ({runner: 'runner_docker_1', image, daemon: 'actual host daemon', authentication: 'anonymous', auth: ''}),
  pull: async () => ({success: false, code: 'PULL_FAILED'})};
test('all routes authenticate before target access or execution', async () => {
  let reads = 0;
  await fixture({...deps, targets: async () => {reads++; return targets;}}, async request => {
    for (const [url, body] of [['', undefined], ['/connection', {target: 'registry'}], ['/pull', {runner: 'runner_docker_1'}]]) assert.equal((await request(url, body, false)).status, 401);
  }); assert.equal(reads, 0);
});
test('no automatic probe/pull; configured-only actions; no-store and no raw errors', async () => {
  let pulls = 0; const probe = driver();
  await fixture({...deps, probe, pull: async () => {pulls++; throw Error('secret=must-not-leak');}}, async request => {
    assert.equal((await request('')).status, 200); assert.equal(probe.calls.length, 0); assert.equal(pulls, 0);
    for (const input of [{target: 'http://169.254.169.254'}, {target: 'registry', url: 'http://evil'}, {}]) assert.equal((await request('/connection', input)).status, 400);
    for (const input of [{runner: 'foreign'}, {runner: 'runner_docker_1', image: image}, {command: 'sh'}]) assert.equal((await request('/pull', input)).status, 400);
    const response = await request('/pull', {runner: 'runner_docker_1'});
    assert.equal(response.status, 503); assert.equal(response.cache, 'no-store'); assert(!response.text.includes('must-not-leak'));
  });
});
test('successful HTTP and failing daemon pull remain independent facts', async () => {
  await fixture(deps, async request => {
    const connection = JSON.parse((await request('/connection', {target: 'helper'})).text);
    const pull = JSON.parse((await request('/pull', {runner: 'runner_docker_1'})).text);
    assert.equal(connection.steps[3].code, 'HTTP_401_CHALLENGE'); assert.equal(pull.success, false);
    assert.equal(pull.code, 'PULL_FAILED'); assert.equal(pull.context, 'actual host daemon');
  });
});
test('configuration drift rejects a different actual runner helper before pull', async () => {
  await fixture({...deps, inspect: async () => ({...await deps.inspect(), image: image.replace('x86_64-v1', 'x86_64-v2')}), pull: async () => {throw Error('must not pull');}}, async request => {
    assert.equal((await request('/pull', {runner: 'runner_docker_1'})).status, 409);
  });
});
test('bounded concurrency rejects a second pull while first is running', async () => {
  let release, entered; const started = new Promise(resolve => {entered = resolve;});
  await fixture({...deps, pull: async () => {entered(); return new Promise(resolve => {release = resolve;});}}, async request => {
    const first = request('/pull', {runner: 'runner_docker_1'}); await started;
    assert.equal((await request('/pull', {runner: 'runner_docker_1'})).status, 429);
    release({success: true, code: 'PULLED'}); assert.equal((await first).status, 200);
  });
});

test('native pull uses verified socket/exact image; daemon stream error and timeout are safe', async () => {
  const {pullHelper} = require('../../sync/dist/SystemDiagnosticsDocker');
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-daemon-'));
  let responseBody = '', hanging = false;
  const socket = path.join(directory, 'daemon.sock');
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(new URL(req.url, 'http://daemon').searchParams.get('fromImage'), image);
    assert.equal(req.headers['x-registry-auth'], Buffer.from('{}').toString('base64url'));
    res.writeHead(200); if (!hanging) res.end(responseBody); else res.flushHeaders();
  });
  await new Promise(resolve => server.listen(socket, resolve));
  const transport = (options, callback) => {assert.equal(options.socketPath, '/var/run/docker.sock'); return http.request({...options, socketPath: socket}, callback);};
  const context = await inspectRunner('runner_docker_1', inspectFixture().read);
  try {
    responseBody = '{"status":"Status: Image is up to date for registry.example.test/helper"}\n';
    assert.equal((await pullHelper(context, transport)).success, true);
    responseBody = '{"error":"token=must-not-leak password=must-not-leak"}\n';
    const failed = await pullHelper(context, transport); assert.equal(failed.code, 'PULL_FAILED'); assert(!JSON.stringify(failed).includes('must-not-leak'));
    responseBody = ''; assert.equal((await pullHelper(context, transport)).code, 'PULL_UNCONFIRMED');
    responseBody = 'x'.repeat(70000); assert.equal((await pullHelper(context, transport)).code, 'OUTPUT_LIMIT');
    hanging = true; assert.equal((await pullHelper(context, transport, 25)).code, 'PULL_TIMEOUT');
  } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true});}
});

test('native TLS timeout is bounded against a controlled stalled fixture', async () => {
  const net = require('node:net');
  const sockets = new Set();
  const server = net.createServer(socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await nativeProbe.tcp('127.0.0.1', server.address().port);
    const start = performance.now();
    await assert.rejects(nativeProbe.tls('127.0.0.1', server.address().port, 'localhost'), error => error.code === 'ETIMEDOUT');
    assert(performance.now() - start < 5000);
  } finally {for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));}
});

test('server target configuration preserves explicit default/nondefault ports and local helper scheme', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const {diagnosticTargets} = require('../../sync/dist/SystemDiagnostics');
  const docker = require('../../sync/dist/SystemDiagnosticsDocker');
  const Helper = require('../../sync/dist/Helper').default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-targets-'));
  const previousDirectory = process.env.SYSTEM_CONFIG_DIR, originalRead = docker.dockerRead;
  process.env.SYSTEM_CONFIG_DIR = directory; docker.dockerRead = async () => 'runner_docker_1\nforeign_docker_1\n';
  const save = url => fs.writeFileSync(path.join(directory, '.docker.env'), Helper.textLogo + '\nGITLAB_REGISTRY_URL="' + url + '"\nGITLAB_REGISTRY_DOMAIN_MODE=0\nGITLAB_RUNNER_SCALE=1\nGITLAB_RUNNER_HELPER_IMAGE="' + image.replace('registry.example.test', new URL(url).host) + '"\n');
  try {
    save('http://registry.example.test:80');
    let selected = await diagnosticTargets(); assert.equal(selected.registry, 'http://registry.example.test'); assert.equal(selected.helper, selected.registry);
    save('http://registry.example.test:5055');
    selected = await diagnosticTargets(); assert.equal(selected.registry, 'http://registry.example.test:5055'); assert.equal(selected.helper, selected.registry); assert.deepEqual(selected.runners, ['runner_docker_1']);
    save('http://registry.example.test');
    selected = await diagnosticTargets(); assert.equal(selected.registry, 'http://registry.example.test:5050');
    assert(!JSON.stringify(selected).includes('GITLAB_RUNNER_SCALE'));
  } finally {
    docker.dockerRead = originalRead;
    if (previousDirectory === undefined) delete process.env.SYSTEM_CONFIG_DIR; else process.env.SYSTEM_CONFIG_DIR = previousDirectory;
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('at most two active diagnostic requests execute', async () => {
  let release; let entered = 0; let markEntered;
  const both = new Promise(resolve => {markEntered = resolve;}); const wait = new Promise(resolve => {release = resolve;});
  await fixture({...deps, targets: async () => {entered++; if (entered === 2) markEntered(); await wait; return targets;}}, async request => {
    const first = request(''), second = request(''); await both;
    assert.equal((await request('')).status, 429); release();
    assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  });
});
