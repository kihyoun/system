import { spawn, ChildProcess } from 'node:child_process';
export interface EnvironmentCommandOptions {
  cleanup?: boolean;
  release?: boolean;
  timeout?: number;
}
export class EnvironmentProcess {
  cancelled = false;
  children = new Set<ChildProcess>();
  cleanupDeadline?: number;
  deadline = Date.now() + 480000;
  cancel() {
    this.cancelled = true;
    this.cleanupDeadline ||= Date.now() + 90000;
    for (const child of this.children) child.kill('SIGTERM');
  }
  command(args: string[], input = '', options: EnvironmentCommandOptions = {}): Promise<string> {
    if (!options.cleanup && (this.cancelled || Date.now() >= this.deadline))
      return Promise.reject(new Error('Environment operation cancelled or timed out.'));
    if (
      options.cleanup &&
      !options.release &&
      this.cleanupDeadline &&
      Date.now() >= this.cleanupDeadline
    )
      return Promise.reject(
        new Error('Bounded recovery budget exhausted; reservation retained for reconciliation.'),
      );
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.children.add(child);
      let output = '',
        total = 0,
        finished = false;
      const budget =
        options.cleanup && !options.release && this.cleanupDeadline
          ? Math.max(1, this.cleanupDeadline - Date.now())
          : Infinity;
      const timer = setTimeout(
        () => {
          child.kill('SIGKILL');
          done(new Error('Bounded Docker operation timed out.'));
        },
        Math.min(options.timeout || 180000, budget),
      );
      const done = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.children.delete(child);
        if (error) reject(error);
        else resolve(output.trim());
      };
      child.stdout.on('data', (chunk) => {
        total += chunk.length;
        if (total > 2000000) {
          child.kill('SIGKILL');
          done(new Error('Bounded Docker response exceeded its limit.'));
        } else output += chunk;
      });
      child.stderr.resume();
      child.on('error', () => done(new Error('Docker command unavailable.')));
      child.on('close', (code) =>
        done(
          code === 0 ? undefined : new Error('Owned Docker or canonical environment check failed.'),
        ),
      );
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    });
  }
}
