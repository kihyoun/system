'use strict';
const core=require('../operations/dist/storage/coordinated-backup');
const {normalizePreview}=require('../operations/dist/runtime/preview-settings');
module.exports={...core,capture:state=>core.capture(state,normalizePreview),
  runWorkflow:options=>core.runWorkflow({...options,normalizePreview})};
