'use strict';
// Compatibility entry; typed release policy owns sanitization and transition evidence.
const {publicUpgradeAssets}=require('../operations/dist/release');
const policy={evidence:require('./publish-successor'),lifecycle:require('./guided-preview-evidence')};
module.exports={publicUpgrade:(metadata,released,proof,graph,jobs)=>publicUpgradeAssets(metadata,released,proof,graph,jobs,policy)};
