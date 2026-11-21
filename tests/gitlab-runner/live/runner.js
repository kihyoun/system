'use strict';
const entry = require('../../../operations/dist/testing/live-audit-entry');
if (require.main === module) entry.liveAuditMain('runner').catch(entry.liveAuditFailure);
