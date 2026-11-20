#!/usr/bin/env node
'use strict';
require('../../operations/dist/renovate/setup-entry').main(process.argv.slice(2)).then(
  result => console.log(JSON.stringify(result)),
  () => { console.error('Renovate setup failed; inspect private ownership inputs and GitLab permissions.'); process.exitCode = 1; },
);
