#!/usr/bin/env node
'use strict';
require('../../operations/dist/renovate/verify-entry').main(process.argv.slice(2)).then(
  result => console.log(JSON.stringify(result)),
  () => { console.error('Renovate discovery verification failed; check private inputs and the owned schedule.'); process.exitCode = 1; },
);
