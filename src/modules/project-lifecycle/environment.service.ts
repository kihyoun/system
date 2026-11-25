import { Inject, Injectable } from '@nestjs/common';
import { Runtime } from './environmentRuntime';
import { RuntimeContext } from './environmentTypes';
@Injectable()
export class EnvironmentService {
  constructor(@Inject(Runtime) readonly runtime: Runtime) {}

  run() {
    return this.runtime.run();
  }

  async cleanupStopped() {
    const runtime = this.runtime,
      operation = runtime.request.operation;

    if (!/^[a-f0-9]{48}$/.test(operation || '')) {
      throw new Error('Invalid environment reservation.');
    }

    runtime.helperName = 'wizard-environment-maintenance-' + runtime.token;
    let attempted = false,
      locked = false;
    try {
      attempted = true;
      await runtime.canonical('lock');
      locked = true;
      runtime.context = await runtime.canonical<RuntimeContext>('read');
      runtime.environment = runtime.context.receipt.wizardWorkflow
        .environments as typeof runtime.environment;

      if (runtime.environment.operation !== operation) {
        throw new Error('Environment reservation changed.');
      }

      const deployments = runtime.environment.deployments || {};

      if (Object.values(deployments).some((slot) => slot.active || slot.pending)) {
        throw new Error('Stop active and reconcile pending deployments before settings cleanup.');
      }

      for (const kind of ['review', 'beta'] as const) {
        runtime.request.kind = kind;
        await runtime.cleanupStoppedRoute(runtime.environment.deployments?.[kind] || {});
      }
      return { state: 'complete' };
    } finally {
      if (attempted) {
        try {
          await runtime.canonical('unlock', {}, true);
        } catch (error) {
          if (locked) {
            throw error;
          }
        }
      }
    }
  }
}
