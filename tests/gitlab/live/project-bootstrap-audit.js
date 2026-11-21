'use strict';
const entry = require('../../../dist/modules/testing/live-audit-entry');
if (require.main === module) entry.liveAuditMain('project').catch(entry.liveAuditFailure);
