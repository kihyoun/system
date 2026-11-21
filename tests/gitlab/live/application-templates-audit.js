'use strict';
const entry = require('../../../dist/modules/testing/live-audit-entry');
if (require.main === module) entry.liveAuditMain('templates').catch(entry.liveAuditFailure);
