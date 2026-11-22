#!/opt/system-public-upgrade/node
'use strict';
const path = require('node:path');
const fixture = process.env.SYSTEM_PUBLIC_UPGRADE_FIXTURE;
const entry = fixture ? path.join(fixture, 'runtime/dist/modules/testing/publicUpgradeEntry.js') : '../../dist/modules/testing/publicUpgradeEntry';
require(entry).main('docker', process.argv[1], process.argv.slice(2)).catch(() => { console.error('public-upgrade-fixture-failed'); process.exitCode = 1; });
