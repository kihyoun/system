'use strict';
const assert = require('node:assert/strict');
const {assess} = require('../codeql/check-sarif');
const complete = () => ({version: '2.1.0', runs: [{tool: {driver: {name: 'CodeQL', semanticVersion: '2.27.4', rules: [{id: 'js/example'}]}},
  invocations: [{executionSuccessful: true, toolExecutionNotifications: ['js/baseline/expected-extracted-files',
    'js/diagnostics/successfully-extracted-files'].map(id => ({descriptor: {id},
      locations: [{physicalLocation: {artifactLocation: {uri: 'sync/src/index.ts'}}}]}))}], artifacts: [{location: {uri: 'sync/src/index.ts'}}], results: []}]});
assert.deepEqual(assess(complete()), {passed: true, findings: 0, expectedFiles: 1, extractedFiles: 1});
for (const result of [{ruleId: 'js/example', level: 'note'},
  {ruleId: 'js/example', baselineState: 'unchanged', suppressions: [{kind: 'inSource'}]}]) {
  const report = complete(); report.runs[0].results.push(result);
  assert.deepEqual(assess(report), {passed: false, findings: 1, expectedFiles: 1, extractedFiles: 1});
}
for (const mutate of [value => value.runs = [], value => delete value.runs[0].results,
  value => delete value.runs[0].invocations, value => value.runs[0].invocations[0].executionSuccessful = false,
  value => value.runs[0].invocations[0].toolExecutionNotifications = [{level: 'error'}],
  value => value.runs[0].invocations[0].toolExecutionNotifications = [],
  value => value.runs[0].invocations[0].toolExecutionNotifications.pop(),
  value => value.runs[0].invocations[0].toolExecutionNotifications.push({descriptor: {id: 'js/diagnostics/extraction-errors'}, level: 'warning'}),
  value => value.runs[0].artifacts = [], value => value.runs[0].tool.driver.rules = []]) {
  const report = complete(); mutate(report); assert.throws(() => assess(report));
}
console.log('PASS: zero findings requires successful complete CodeQL execution, query metadata and source coverage; suppressed/baseline results fail.');
