'use strict';
const fs = require('node:fs');
function assess(sarif, manifest) {
  if (sarif?.version !== '2.1.0' || !Array.isArray(sarif.runs) || sarif.runs.length !== 1)
    throw Error('Expected one complete SARIF 2.1.0 CodeQL run.');
  const run = sarif.runs[0];
  if (run.tool?.driver?.name !== 'CodeQL' || run.tool.driver.semanticVersion !== '2.27.4' || !Array.isArray(run.results) ||
      !Array.isArray(run.invocations) || !run.invocations.length ||
      run.invocations.some(invocation => invocation.executionSuccessful !== true ||
        invocation.toolExecutionNotifications?.some(notification => notification.level === 'error')))
    throw Error('CodeQL execution evidence is incomplete or failed.');
  const rules = [run.tool.driver, ...(run.tool.extensions || [])].flatMap(tool => tool.rules || []);
  if (!rules.length || !Array.isArray(run.artifacts) ||
      !run.artifacts.some(artifact => /\.(?:[cm]?js|jsx|tsx?|html|vue|svelte)(?:$|[?#])/i.test(artifact.location?.uri || '')))
    throw Error('Missing query metadata or baseline source-file coverage.');
  const notifications = run.invocations.flatMap(invocation => invocation.toolExecutionNotifications || []);
  if (notifications.some(notification => notification.descriptor?.id === 'js/diagnostics/extraction-errors'))
    throw Error('CodeQL reported incomplete JavaScript/TypeScript extraction.');
  const files = id => new Set(notifications.filter(notification => notification.descriptor?.id === id)
    .flatMap(notification => (notification.locations || []).map(location => location.physicalLocation?.artifactLocation?.uri))
    .filter(Boolean));
  const expected = files('js/baseline/expected-extracted-files');
  const extracted = files('js/diagnostics/successfully-extracted-files');
  if (!expected.size || !extracted.size || [...expected].some(file => !extracted.has(file)))
    throw Error('Missing or incomplete extraction coverage diagnostics.');
  if (!Array.isArray(manifest?.files) || manifest.files.some(file => typeof file !== 'string'))
    throw Error('Missing committed source manifest.');
  const committed = manifest.files.filter(file => /\.(?:[cm]?js|jsx|tsx?)$/i.test(file));
  // CodeQL's baseline can omit nested packages even when the extractor visits
  // them. Require all committed JavaScript/TypeScript inputs independently.
  if (!committed.length || committed.some(file => !extracted.has(file)))
    throw Error('Committed JavaScript/TypeScript source was not fully extracted.');
  // Gate every emitted result, including baseline/suppressed results. No rule,
  // severity, path or pre-existing-finding exemptions are applied here.
  return {passed: run.results.length === 0, findings: run.results.length, expectedFiles: expected.size, extractedFiles: extracted.size, committedFiles: committed.length};
}
module.exports = {assess};
if (require.main === module) {
  try {
    const result = assess(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
      JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
