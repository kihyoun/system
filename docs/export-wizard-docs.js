#!/usr/bin/env node
'use strict';
// Build the pinned operations package first; document authoring never installs dependencies.
const path = require('node:path');
if (require.main === module) {
  require('../operations/dist/documentation/entry').main(process.argv.slice(2), path.resolve(__dirname, '..'))
    .then(count => console.log(`Wizard documentation ${process.argv.includes('--check') ? 'verified' : 'exported'}: ${count} chapters.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
