#!/usr/bin/env node
'use strict';
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const aliases = {
  'initialize': 'initialize', 'verify-runtime': 'verify-runtime',
  'install': 'install-host', 'recover-volume': 'recover-volume',
  'install-runtime': 'install-runtime', 'refresh-ca': 'refresh-ca',
  'prepare-local': 'prepare-local', 'install-volume-host': 'install-volume-host',
  'install-volume-certificate': 'install-certificate', 'certbot-with-volume-lock': 'certbot',
};
const action = aliases[path.basename(process.argv[1], '.js')];
if (!action) throw Error('Unknown host bootstrap entry.');
void require('../operations/dist/host-bootstrap/entry').main([action, '--checkout', root, ...process.argv.slice(2)]).catch(error => {
  console.error(error instanceof SyntaxError || error instanceof TypeError ? 'Invalid host bootstrap input or runtime response.' : error.message);
  process.exitCode = 1;
});
