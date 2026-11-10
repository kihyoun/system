#!/usr/bin/env node
'use strict';
// Invoke inside the running native controller after independently selecting
// its source revision/tree, pinned Wizard gitlink and immutable image pair.
const {recordInstallation} = require('../project-bootstrap/wizard-source-primary/source-installation');
function parse(arguments_) {
  const names = {'--controller': 'controller', '--wizard': 'wizard', '--source-revision': 'sourceCommit',
    '--source-tree': 'sourceTree', '--wizard-revision': 'wizardSourceRevision'};
  const input = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = names[arguments_[index]];
    if (!key || Object.hasOwn(input, key) || !arguments_[index + 1]) throw Error('usage');
    input[key] = arguments_[index + 1];
  }
  if (Object.keys(input).length !== Object.keys(names).length) throw Error('usage');
  return input;
}
function main(arguments_) {
  try {
    recordInstallation(parse(arguments_));
    process.stdout.write('Source installation provenance recorded; Production images and configuration are unchanged.\n');
    return 0;
  } catch (_) {
    process.stderr.write('Source installation recording refused. Supply the independently selected source identities and actual immutable image pair; retain matching saved selectors and paired image provenance.\n');
    return 1;
  }
}
module.exports = {parse, main};
if (require.main === module) process.exitCode = main(process.argv.slice(2));
