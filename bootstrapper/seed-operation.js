#!/usr/bin/env node
'use strict';
process.umask(0o077);
void require('../operations/dist/host/storage-entry').hostStorageMain(process.argv.slice(2)).catch(() => {
  process.stderr.write('Host storage failed or its outcome is uncertain. Retain the owned launcher and storage lease; inspect operation state before retrying.\n');
  process.exitCode = 1;
});
