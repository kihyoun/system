import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';
export interface EnvironmentCommandOptions {
  cleanup?: boolean;
  release?: boolean;
  timeout?: number;
}
export class EnvironmentProcess {
  cancelled = false;
  private readonly children = new Set<AbortController>();
  cleanupDeadline?: number;
  deadline = Date.now() + 480000;
  constructor(private readonly processRunner: LifecycleProcess = new ManagedChildProcess()) {}

  cancel() {
    this.cancelled = true;
    this.cleanupDeadline ||= Date.now() + 90000;
    for (const child of this.children) {
      child.abort();
    }
  }

  async command(
    args: string[],
    input = '',
    options: EnvironmentCommandOptions = {},
  ): Promise<string> {
    if (!options.cleanup && (this.cancelled || Date.now() >= this.deadline)) {
      throw new Error('Environment operation cancelled or timed out.');
    }

    if (
      options.cleanup &&
      !options.release &&
      this.cleanupDeadline &&
      Date.now() >= this.cleanupDeadline
    ) {
      throw new Error(
        'Bounded recovery budget exhausted; reservation retained for reconciliation.',
      );
    }

    const budget = options.cleanup
      ? !options.release && this.cleanupDeadline
        ? this.cleanupDeadline - Date.now()
        : Infinity
      : this.deadline - Date.now();
    const child = new AbortController();
    this.children.add(child);
    try {
      return (
        await this.processRunner.run('docker', args, {
          cwd: process.cwd(),
          env: process.env,
          input,
          signal: child.signal,
          timeout: Math.max(1, Math.min(options.timeout ?? 180000, budget)),
          maxBuffer: 2000000,
        })
      ).trim();
    } finally {
      this.children.delete(child);
    }
  }
}
