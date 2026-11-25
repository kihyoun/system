import { spawn } from 'node:child_process';
import path from 'node:path';
export class ObservationFailure extends Error {
  constructor(
    readonly reason: 'command-unavailable' | 'command-timeout' | 'output-limit' | 'cancelled',
  ) {
    super(reason);
  }
}
/** Own only the created process group (or Windows PID/tree), with bounded output and cleanup. */
export class ObservationProcess {
  run(
    args: string[],
    timeout: number,
    signal?: AbortSignal,
    output?: (chunk: Buffer) => void,
  ): Promise<string> {
    if (signal?.aborted) {
      return Promise.reject(new ObservationFailure('cancelled'));
    }

    return new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), {
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let bytes = 0,
        text = '',
        reason: ObservationFailure['reason'] | undefined,
        closed = false,
        code: number | null = null,
        cleaned = false;
      const finish = () => {
        if (!closed || (reason && !cleaned)) {
          return;
        }

        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        reason
          ? reject(new ObservationFailure(reason))
          : code === 0
            ? resolve(text.replace(/\r\n?/g, '\n'))
            : reject(new ObservationFailure('command-unavailable'));
      };
      const kill = (value: NodeJS.Signals) => {
        if (child.pid) {
          try {
            process.kill(process.platform === 'win32' ? child.pid : -child.pid, value);
          } catch {}
        }
      };
      const stop = (value: ObservationFailure['reason']) => {
        if (reason) {
          return;
        }

        reason = value;

        if (process.platform === 'win32' && child.pid) {
          const killer = spawn(
            path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          );
          const bound = setTimeout(() => killer.kill(), 1000);
          killer.on('error', () => {});
          killer.on('close', () => clearTimeout(bound));
        } else {
          kill('SIGTERM');
        }

        setTimeout(
          () => {
            kill('SIGKILL');
            cleaned = true;
            finish();
            setTimeout(() => {
              if (!closed) {
                closed = true;
                finish();
              }
            }, 200).unref();
          },
          process.platform === 'win32' ? 1000 : 100,
        );
      };
      const cancel = () => stop('cancelled'),
        timer = setTimeout(() => stop('command-timeout'), Math.max(1, timeout));
      signal?.addEventListener('abort', cancel, { once: true });
      const consume = (chunk: Buffer, retain: boolean) => {
        bytes += chunk.length;

        if (bytes > 2_000_000) {
          stop('output-limit');
          return;
        }

        if (retain) {
          text += chunk.toString();
        }

        try {
          output?.(chunk);
        } catch {
          stop('command-unavailable');
        }
      };
      child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
      child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
      child.on('error', () => stop('command-unavailable'));
      child.on('close', (value) => {
        closed = true;
        code = value;
        finish();
      });
    });
  }
}
