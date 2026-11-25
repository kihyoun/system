import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { LifecycleProcess, ChildOptions } from '../../common/runtime/managedChild';
import { wizardRecoveryProcess, type RecoveryReadinessPort } from './ports';
@Injectable()
export class WizardRecoveryReadinessService implements RecoveryReadinessPort {
  constructor(@Inject(wizardRecoveryProcess) private readonly children: LifecycleProcess) {}

  async wait(options: ChildOptions): Promise<void> {
    const deadline = Date.now() + 300000;
    do {
      options.signal?.throwIfAborted();
      try {
        await this.children.run(
          'docker',
          [
            '--host=unix:///var/run/docker.sock',
            'exec',
            'system_gitlab_1',
            'curl',
            '-fsS',
            '--max-time',
            '3',
            'http://127.0.0.1/-/readiness',
          ],
          { ...options, timeout: Math.min(10000, deadline - Date.now()) },
        );
        return;
      } catch {
        options.signal?.throwIfAborted();
      }
      await delay(2500, undefined, { signal: options.signal });
    } while (Date.now() < deadline);
    throw Error('GitLab did not become ready for registry recovery.');
  }
}
