// Use Git's existing whitespace/conflict check; do not install a separate linter.
import { TextDecoder } from 'node:util';
import { NativeDocumentationGit, type DocumentationGit } from './documentation-git';

export function check(
  environment: NodeJS.ProcessEnv = process.env,
  directory = process.cwd(),
  processes: DocumentationGit = new NativeDocumentationGit(),
) {
  const git = (...args: string[]) => processes.run(args, directory, environment);
  const revision = git('rev-parse', '--verify', 'HEAD^{commit}').toString().trim();
  if (
    !/^[a-f0-9]{40}$/.test(environment.CI_COMMIT_SHA || '') ||
    revision !== environment.CI_COMMIT_SHA
  )
    throw Error('The checkout must match CI_COMMIT_SHA.');
  let base;
  if (environment.CI_PIPELINE_SOURCE === 'merge_request_event') {
    base = environment.CI_MERGE_REQUEST_DIFF_BASE_SHA;
    if (!/^[a-f0-9]{40}$/.test(base || '') || /^0+$/.test(base || ''))
      throw Error('The merge-request diff base is missing or invalid.');
  } else if (environment.CI_PIPELINE_SOURCE === 'push') {
    base = environment.CI_COMMIT_BEFORE_SHA;
    if (!/^[a-f0-9]{40}$/.test(base || ''))
      throw Error('The push diff base is missing or invalid.');
    // A first branch push has no previous commit. Check its complete tree.
    if (/^0+$/.test(base || ''))
      base = git('hash-object', '-t', 'tree', '--stdin').toString().trim();
  } else {
    // Scheduled/manual default-branch runs retain the full runtime lane. Check
    // the last commit without inventing a documentation-only classification.
    try {
      base = git('rev-parse', '--verify', 'HEAD^').toString().trim();
    } catch (_) {
      base = git('hash-object', '-t', 'tree', '--stdin').toString().trim();
    }
  }
  try {
    git('diff', '--no-ext-diff', '--no-textconv', '--check', base || '', revision);
  } catch (_) {
    throw Error(
      'Git diff --check failed; check changed whitespace/conflict markers and diff-base availability.',
    );
  }
  const changed = git(
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--name-only',
    '--diff-filter=ACMRT',
    '-z',
    base || '',
    revision,
  )
    .toString()
    .split('\0')
    .filter(Boolean);
  const documents = changed.filter((name) => name.endsWith('.md'));
  for (const name of documents) {
    const entry = git('ls-tree', '-z', revision, '--', name).toString();
    if (!/^100(?:644|755) blob /.test(entry))
      throw Error('Changed Markdown must be a regular file.');
    const data = git('show', revision + ':' + name);
    if (data.includes(0)) throw Error('Changed Markdown contains binary data.');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch (_) {
      throw Error('Changed Markdown must be valid UTF-8.');
    }
  }
  return {
    version: 1,
    revision,
    base,
    whitespaceAndConflictMarkers: true,
    markdownFiles: documents,
  };
}
