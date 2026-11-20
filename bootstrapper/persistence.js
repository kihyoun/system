#!/usr/bin/env node
'use strict';
void require('../operations/dist/host-lifecycle/entry').hostLifecycle('persistence', require('node:path').resolve(__dirname, '..')).catch(error => {
  console.error(error instanceof Error ? error.message : 'Host lifecycle failed.');
  process.exitCode = 1;
});
