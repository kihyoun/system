'use strict';
// Compatibility entry; storage policy and workflows live in the compiled package.
const root='../operations/dist/storage/';
const {StorageService}=require(root+'storage.service');
const {nativeProcess}=require('../operations/dist/runtime/process');
const {normalizePreview}=require('../operations/dist/runtime/preview-settings');
const service=new StorageService(nativeProcess,normalizePreview);
module.exports=Object.assign({},...['validation','configuration','lease','helper'].map(name=>require(root+name)),{
  inside:spec=>service.inside(spec),launch:(operation,options)=>service.launch(operation,options),
});
if(require.main===module){const entry=require(root+'entry');entry.main().catch(entry.reportFailure);}
