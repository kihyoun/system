#!/usr/bin/env node
'use strict';
// Compatibility boundary. Prepare the operations runtime before maintenance.
module.exports=require('../operations/dist/gitlab-upgrade/compatibility');
if(require.main===module){const entry=require('../operations/dist/gitlab-upgrade/entry');entry.main().catch(entry.reportFailure);}
