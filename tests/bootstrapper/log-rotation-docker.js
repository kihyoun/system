#!/usr/bin/env node
'use strict';
// Small real-Docker probe; called by candidate image preparation, never by the
// socket-free component suite. All resources carry one random ownership value.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const path = require('node:path');

function run({helperImage}) {
  assert(helperImage, 'An already built candidate image is required.');
  const operation = randomUUID().replaceAll('-', '');
  const label = 'org.system-bootstrapper.log-rotation-probe';
  const created = [];
  const docker = (args, options = {}) => execFileSync('docker', args,
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000, maxBuffer: 4 * 1024 * 1024, ...options}).trim();
  const inspect = name => JSON.parse(docker(['container', 'inspect', name]))[0];
  const image = JSON.parse(docker(['image', 'inspect', helperImage]))[0].Id;
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  try {
    for (const component of ['system', 'nginx-proxy']) {
      const name = 'system-log-config-' + operation + '-' + component;
      created.push(name);
      const config = JSON.parse(docker(['run', '--rm', '--name', name, '--label', label + '=' + operation,
        '--network', 'none', '--read-only', '--log-driver', 'none', '--memory', '128m', '--cpus', '0.5', '--pids-limit', '32',
        '-e', 'PERSISTENT_DIR=/logging-fixture-unmounted', '-e', 'SYSTEM_LOG_MAX_SIZE=20m', '-e', 'SYSTEM_LOG_MAX_FILES=4',
        '--entrypoint', 'docker', image, 'compose', '--env-file', '/dev/null',
        '-f', '/system/config/' + component + '/docker-compose.yml', 'config', '--format', 'json']));
      for (const service of Object.values(config.services))
        assert.deepEqual(service.logging, {driver: 'json-file', options: {'max-size': '20m', 'max-file': '4'}});
    }
    for (const generation of [1, 2]) {
      const name = 'system-log-rotation-' + operation + '-' + generation;
      created.push(name);
      const args = ['create', '--name', name, '--label', label + '=' + operation,
        '--network', 'none', '--read-only', '--memory', '64m', '--cpus', '0.5', '--pids-limit', '32',
        '--log-driver', 'json-file', '--log-opt', 'max-size=64k', '--log-opt', 'max-file=3',
        '--entrypoint', 'node', image, '-e',
        "console.log('oldest-marker');for(let n=0;n<2048;n++)console.log(n+':'+'x'.repeat(1024));console.log('newest-marker');"];
      docker(args);
      docker(['start', name]);
      assert.equal(docker(['wait', name]), '0');
      const container = inspect(name);
      assert.deepEqual(container.HostConfig.LogConfig, {Type: 'json-file', Config: {'max-file': '3', 'max-size': '64k'}});
      const logs = docker(['logs', name]);
      assert(logs.includes('newest-marker'));
      assert(!logs.includes('oldest-marker'), 'old records must disappear after size rotation');
      assert(Buffer.byteLength(logs) < 3 * 65536 + 4096);
      const logPath = container.LogPath;
      assert.equal(path.basename(logPath), container.Id + '-json.log');
      // Only stat the files belonging to this disposable container. No external
      // tool opens, truncates, deletes or rotates Docker's live log files.
      const metadata = name + '-stat';
      created.push(metadata);
      const files = JSON.parse(docker(['run', '--rm', '--name', metadata, '--network', 'none', '--read-only', '--log-driver', 'none',
        '--label', label + '=' + operation, '--memory', '64m', '--cpus', '0.5', '--pids-limit', '32',
        '--mount', 'type=bind,source=' + path.dirname(logPath) + ',target=/logs,readonly',
        '--entrypoint', 'node', image, '-e',
        "const fs=require('node:fs');console.log(JSON.stringify(fs.readdirSync('/logs').filter(n=>n.startsWith(" +
        JSON.stringify(path.basename(logPath)) + ")).map(n=>({name:n,size:fs.statSync('/logs/'+n).size}))));"]));
      assert.equal(files.length, 3);
      assert(files.every(file => file.size > 0 && file.size <= 65536 + 4096));
      console.log('Docker logging generation ' + generation + ': three bounded files and rotated readback verified.');
    }
  } finally {
    for (const name of created.reverse()) {
      // A failed create must not make cleanup delete an unrelated name collision.
      let container;
      try { container = inspect(name); } catch { continue; }
      assert.equal(container.Config.Labels[label], operation, 'Refuse unowned cleanup.');
      assert.equal(container.Image, image, 'Refuse unexpected image identity during cleanup.');
      docker(['rm', '-f', container.Id]);
    }
  }
}
module.exports = {run};
if (require.main === module) {
  try {
    assert.equal(process.argv[2], '--allow-selected-daemon',
      'Usage: node tests/bootstrapper/log-rotation-docker.js --allow-selected-daemon ALREADY_PULLED_IMAGE');
    assert.equal(process.argv.length, 4);
    run({helperImage: process.argv[3]});
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
