#!/opt/system-public-upgrade/node
'use strict';
const path = require('node:path');
const fixture = process.env.SYSTEM_PUBLIC_UPGRADE_FIXTURE;
const entry = fixture ? path.join(fixture, 'runtime/dist/modules/testing/public-upgrade-host-entry.js') : '../../dist/modules/testing/public-upgrade-host-entry';
require(entry).publicUpgradeHostMain().catch(() => {
  process.stderr.write('SYSTEM_PUBLIC_UPGRADE_DIAGNOSTIC unclassified-error\n');
  process.exitCode = 1;
});
