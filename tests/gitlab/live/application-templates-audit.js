'use strict';
const entry = require('../../../dist/modules/testing/liveAuditEntry');
if (require.main === module) entry.liveAuditMain('templates').catch(entry.liveAuditFailure);
