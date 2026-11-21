'use strict';
const entry = require('../../../operations/dist/testing/live-audit-entry');
if (require.main === module) entry.liveAuditMain('templates').catch(entry.liveAuditFailure);
