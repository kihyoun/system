import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ProcessFailure } from './process';
export interface ChildOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  input?: string;
  /** Stream a regular file directly to stdin without buffering an archive in memory. */
  inputFile?: string;
  /** null is reserved for foreground services, which have no wall-clock deadline. */
  timeout: number | null;
  maxBuffer?: number;
  inherit?: boolean;
  /** Receives bounded stdout/stderr for an owned diagnostic artifact. */
  output?: (chunk: Buffer) => void;
  /** A verified upgrade supervisor already owns and journals this process group. */
  inheritGroup?: boolean;
}
export interface LifecycleProcess {
  run(binary: string, args: readonly string[], options: ChildOptions): Promise<string>;
}
/** Own a process group unless a verified external supervisor already journals it. */
export class ManagedChildProcess implements LifecycleProcess {
  run(binary: string, args: readonly string[], options: ChildOptions): Promise<string> {
    if (options.signal?.aborted)
      return Promise.reject(new ProcessFailure(binary, null, 'SIGTERM', true));
    return new Promise((resolve, reject) => {
      if (options.inputFile && options.input !== undefined) throw Error('ambiguous-process-input');
      const inputFd = options.inputFile
        ? fs.openSync(options.inputFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
        : undefined;
      if (inputFd !== undefined && !fs.fstatSync(inputFd).isFile()) {
        fs.closeSync(inputFd);
        throw Error('regular-process-input-required');
      }
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(binary, [...args], {
          cwd: options.cwd,
          env: options.env,
          detached: !options.inheritGroup,
          shell: false,
          stdio: [
            inputFd ?? 'pipe',
            options.inherit ? 'inherit' : 'pipe',
            options.inherit ? 'inherit' : 'pipe',
          ],
        });
      } finally {
        if (inputFd !== undefined) fs.closeSync(inputFd);
      }
      const output: Buffer[] = [];
      let bytes = 0,
        uncertain = false,
        spawnError = false;
      let forced: NodeJS.Timeout | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (child.pid)
          try {
            process.kill(options.inheritGroup ? child.pid : -child.pid, signal);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') uncertain = true;
          }
      };
      const cancel = () => {
        uncertain = true;
        kill('SIGTERM');
        forced ??= setTimeout(() => kill('SIGKILL'), 5000);
      };
      const timer = options.timeout === null ? undefined : setTimeout(cancel, options.timeout);
      options.signal?.addEventListener('abort', cancel, { once: true });
      child.stdout?.on('data', (value: Buffer) => {
        bytes += value.length;
        if (bytes > (options.maxBuffer ?? 1024 * 1024)) cancel();
        else {
          output.push(value);
          try {
            options.output?.(value);
          } catch {
            cancel();
          }
        }
      });
      child.stderr?.on('data', (value: Buffer) => {
        bytes += value.length;
        if (bytes > (options.maxBuffer ?? 1024 * 1024)) cancel();
        else
          try {
            options.output?.(value);
          } catch {
            cancel();
          }
      });
      child.on('error', () => {
        spawnError = true;
      });
      child.stdin?.on('error', () => {
        /* EPIPE is settled by the child's exit result. */
      });
      child.stdin?.end(options.input);
      child.on('close', (status, signal) => {
        if (timer) clearTimeout(timer);
        if (forced) clearTimeout(forced);
        options.signal?.removeEventListener('abort', cancel);
        // Kill any descendants still holding this owned group after a cancelled parent exits.
        if (uncertain) kill('SIGKILL');
        if (spawnError || status !== 0 || signal || uncertain)
          reject(
            new ProcessFailure(
              binary,
              status,
              signal,
              uncertain || spawnError || signal !== null || status === null,
            ),
          );
        else resolve(Buffer.concat(output).toString('utf8'));
      });
    });
  }
}
