import { spawnSync } from 'node:child_process';

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  timeout?: number;
  maxBuffer?: number;
  /** Exact source-owned output lines mapped to safe codes; never retains child output. */
  controlledFailureCodes?: Readonly<Record<string, string>>;
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
  /** A successful run always has status zero. All other outcomes throw. */
  status: 0;
}
export interface ProcessRunner {
  run(binary: string, args: readonly string[], options?: ProcessOptions): ProcessResult;
}
export class ProcessFailure extends Error {
  readonly code = 'external-command-failed';
  constructor(
    readonly binary: string,
    readonly status: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly uncertain: boolean,
    readonly controlledCode?: string,
  ) {
    // Deliberately omit argv, environment and command output: these may contain secrets.
    super('external-command-failed');
    this.name = 'ProcessFailure';
  }
}
export class NativeProcessRunner implements ProcessRunner {
  run(binary: string, args: readonly string[], options: ProcessOptions = {}): ProcessResult {
    const result = spawnSync(binary, [...args], {
      encoding: 'utf8',
      timeout: options.timeout ?? 180000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      cwd: options.cwd,
      env: options.env ?? process.env,
      input: options.input,
      shell: false,
    });
    if (result.error || result.status !== 0 || result.signal !== null) {
      let controlledCode: string | undefined;
      if (
        options.controlledFailureCodes &&
        !result.error &&
        result.signal === null &&
        result.status !== null &&
        result.status > 0
      ) {
        const lines = new Set((result.stdout + '\n' + result.stderr).split(/\r?\n/));
        const matched = new Set(
          Object.entries(options.controlledFailureCodes ?? {})
            .filter(
              ([line, code]) =>
                line.length > 0 &&
                line.length <= 256 &&
                typeof code === 'string' &&
                /^[a-z][a-z0-9-]{0,63}$/.test(code) &&
                lines.has(line),
            )
            .map(([, code]) => code),
        );
        if (matched.size === 1) controlledCode = [...matched][0];
      }
      throw new ProcessFailure(
        binary,
        result.status,
        result.signal,
        !!result.error || result.status === null || result.signal !== null,
        controlledCode,
      );
    }
    return { stdout: result.stdout, stderr: result.stderr, status: 0 };
  }
}
export const nativeProcess = new NativeProcessRunner();
