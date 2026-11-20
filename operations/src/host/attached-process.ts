import { spawn } from 'node:child_process';
export interface HostAttachedProcess {
  run(binary: string, args: readonly string[], environment: NodeJS.ProcessEnv): Promise<void>;
}
/** Interactive Docker attachment: storage's durable lease owns the operation budget. */
export class NativeHostAttachedProcess implements HostAttachedProcess {
  constructor(private readonly cancellationGraceMs = 10000) {
    if (!Number.isSafeInteger(cancellationGraceMs) || cancellationGraceMs < 1)
      throw Error('invalid-cancellation-grace');
  }
  async run(
    binary: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, [...args], { env: environment, stdio: 'inherit', shell: false });
      let interrupted = false;
      let cancellation: NodeJS.Timeout | undefined;
      const forward = (signal: NodeJS.Signals) => {
        interrupted = true;
        child.kill(signal);
        // Bound only cancellation of our CLI attachment, never the storage job.
        // The labelled container and durable inner lease remain for recovery.
        cancellation ??= setTimeout(() => child.kill('SIGKILL'), this.cancellationGraceMs);
      };
      const terminate = () => forward('SIGTERM'),
        interrupt = () => forward('SIGINT'),
        hangup = () => forward('SIGHUP');
      process.on('SIGTERM', terminate);
      process.on('SIGINT', interrupt);
      process.on('SIGHUP', hangup);
      const cleanup = () => {
        if (cancellation) clearTimeout(cancellation);
        process.off('SIGTERM', terminate);
        process.off('SIGINT', interrupt);
        process.off('SIGHUP', hangup);
      };
      child.once('error', () => {
        cleanup();
        reject(Error('host-storage-launch-outcome-uncertain'));
      });
      child.once('close', (code, signal) => {
        cleanup();
        if (code === 0 && !signal && !interrupted) resolve();
        else reject(Error('host-storage-launch-outcome-uncertain'));
      });
    });
  }
}
