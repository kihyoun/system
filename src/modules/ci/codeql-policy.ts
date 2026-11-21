import fs from 'node:fs';
import path from 'node:path';
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(object) : []);
/** Keep all hidden source directories visible to the upstream extractor. */
export function extractorIncludes(root: string): string[] {
  const paths = ['.'];
  function walk(relative: string): void {
    for (const entry of fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw Error('Prepared static source must not contain links.');
      if (/[\r\n]/.test(entry.name))
        throw Error('Prepared static source contains an invalid line-delimited path.');
      if (entry.name === '.git' || entry.name === 'node_modules')
        throw Error('Prepared static source contains Git metadata or dependencies.');
      if (!entry.isDirectory()) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.name.startsWith('.')) paths.push(name);
      walk(name);
    }
  }
  walk('');
  return paths;
}
/** Every emitted finding and every committed JS/TS source participates in the gate. */
export function assessCodeql(sarifInput: unknown, manifestInput: unknown) {
  const sarif = object(sarifInput),
    manifest = object(manifestInput);
  if (sarif.version !== '2.1.0' || !Array.isArray(sarif.runs) || sarif.runs.length !== 1)
    throw Error('Expected one complete SARIF 2.1.0 CodeQL run.');
  const run = object(sarif.runs[0]),
    tool = object(run.tool),
    driver = object(tool.driver),
    invocations = rows(run.invocations);
  if (
    driver.name !== 'CodeQL' ||
    driver.semanticVersion !== '2.27.4' ||
    !Array.isArray(run.results) ||
    !Array.isArray(run.invocations) ||
    !invocations.length ||
    invocations.some(
      (invocation) =>
        invocation.executionSuccessful !== true ||
        rows(invocation.toolExecutionNotifications).some(
          (notification) => notification.level === 'error',
        ),
    )
  )
    throw Error('CodeQL execution evidence is incomplete or failed.');
  const rules = [driver, ...rows(tool.extensions)].flatMap((tool) => rows(tool.rules));
  if (
    !rules.length ||
    !Array.isArray(run.artifacts) ||
    !rows(run.artifacts).some((artifact) => {
      const uri = object(artifact.location).uri;
      return (
        typeof uri === 'string' &&
        /\.(?:[cm]?js|jsx|[cm]?ts|tsx|html|vue|svelte)(?:$|[?#])/i.test(uri)
      );
    })
  )
    throw Error('Missing query metadata or baseline source-file coverage.');
  const notifications = invocations.flatMap((invocation) =>
    rows(invocation.toolExecutionNotifications),
  );
  if (
    notifications.some(
      (notification) => object(notification.descriptor).id === 'js/diagnostics/extraction-errors',
    )
  )
    throw Error('CodeQL reported incomplete JavaScript/TypeScript extraction.');
  const files = (id: string) =>
    new Set(
      notifications
        .filter((notification) => object(notification.descriptor).id === id)
        .flatMap((notification) =>
          rows(notification.locations).map(
            (location) => object(object(location.physicalLocation).artifactLocation).uri,
          ),
        )
        .filter((uri): uri is string => typeof uri === 'string' && uri.length > 0),
    );
  const expected = files('js/baseline/expected-extracted-files'),
    extracted = files('js/diagnostics/successfully-extracted-files');
  if (!expected.size || !extracted.size || [...expected].some((file) => !extracted.has(file)))
    throw Error('Missing or incomplete extraction coverage diagnostics.');
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => typeof file !== 'string'))
    throw Error('Missing committed source manifest.');
  const committed = manifest.files.filter(
    (file): file is string =>
      typeof file === 'string' && /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i.test(file),
  );
  if (!committed.length || committed.some((file) => !extracted.has(file)))
    throw Error('Committed JavaScript/TypeScript source was not fully extracted.');
  return {
    passed: run.results.length === 0,
    findings: run.results.length,
    expectedFiles: expected.size,
    extractedFiles: extracted.size,
    committedFiles: committed.length,
  };
}
