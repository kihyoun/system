'use strict';
const path=require('node:path');
const persistence=require('../operations/dist/storage/persistence');
module.exports=persistence;
if(require.main===module)persistence.initializeMountedState(path.resolve(process.env.SYSTEM_CONFIG_DIR||'/state'),__dirname);
