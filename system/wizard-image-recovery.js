'use strict';
const path = require('node:path');
const entry = require('../operations/dist/wizard-recovery/entry');
module.exports = {...require('../operations/dist/wizard-recovery/identity'), recoverImage: (settings = process.env) =>
  entry.recoverImage({checkout: path.resolve(__dirname, '..'), settings})};
if (require.main === module) entry.main(path.resolve(__dirname, '..')).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
