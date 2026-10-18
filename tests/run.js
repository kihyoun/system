#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const manifest = require('./manifest.json');
const {runChecks} = require('./shared/run-checks');
const root = path.resolve(__dirname, '..');

async function main() {
  const component = process.argv[2] || 'all';
  const components = [...new Set(manifest.map(item => item.component))];
  if (process.argv.length > 3 || (component !== 'all' && !components.includes(component))) {
    throw Error('Usage: node tests/run.js [all|' + components.join('|') + ']');
  }
  if (process.platform !== 'linux' || process.env.SYSTEM_TEST_ISOLATED !== '1') {
    throw Error('Run in the documented disposable Linux test container with SYSTEM_TEST_ISOLATED=1.');
  }
  if (fs.existsSync('/var/run/docker.sock')) throw Error('The isolated suite must not have a Docker socket mounted.');
  for (const file of ['.docker.env', 'system/.docker.env', 'gitlab/.docker.env']) {
    if (fs.existsSync(path.join(root,file))) throw Error('Use a clean checkout without private runtime configuration: ' + file);
  }
  const selected = manifest.filter(item => component === 'all' || item.component === component);
  if (selected.some(item => item.port === 8071)) {
    await new Promise((resolve,reject) => {
      const server = net.createServer();
      server.once('error', () => reject(Error('Port 8071 is occupied; use a private container network namespace.')));
      server.listen(8071,'127.0.0.1',() => server.close(resolve));
    });
  }
  const results = await runChecks(selected, {root, reportDirectory:path.join(root,'test-results',component)});
  if (results.length !== selected.length || results.some(item => item.status !== 'passed')) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
