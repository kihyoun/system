'use strict';
const {publicAddress} = require('../../operations/dist/project-lifecycle/source-transfer.service');
const {sourceTransfer, sourcePreflight} = require('../../operations/dist/project-lifecycle/source-entry');
module.exports = {publicAddress, transfer: sourceTransfer, originPreflight: sourcePreflight};
