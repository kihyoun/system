'use strict';
const manifest=require('../operations/dist/storage/manifest');
module.exports=manifest;
if(require.main===module)require('../operations/dist/storage/manifest-entry').main(process.argv.slice(2));
