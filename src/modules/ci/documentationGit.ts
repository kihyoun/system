import { spawnSync } from 'node:child_process';
/** Binary Git output is required to reject invalid UTF-8 without replacement decoding. */
export interface DocumentationGit {
  run(args: string[], directory: string, environment: NodeJS.ProcessEnv): Buffer;
}
export class NativeDocumentationGit implements DocumentationGit {
  run(args: string[], directory: string, environment: NodeJS.ProcessEnv): Buffer {
    const result = spawnSync(
      'git',
      ['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', ...args],
      {
        cwd: directory,
        env: environment,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      },
    );

    if (result.error || result.status !== 0 || result.signal) {
      throw Error('documentation-git-operation-failed');
    }

    return result.stdout;
  }
}
