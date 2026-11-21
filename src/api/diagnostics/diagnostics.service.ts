import { Inject, Injectable } from '@nestjs/common';
import { checkRegistry, DiagnosticDependencies } from './system-diagnostics';
import { SyncHttpError } from '../http/sync-http-error';

export const DIAGNOSTIC_DEPENDENCIES = Symbol('DiagnosticDependencies');

@Injectable()
export class DiagnosticsService {
  private active = 0;
  private pulling = false;
  constructor(@Inject(DIAGNOSTIC_DEPENDENCIES) private readonly deps: DiagnosticDependencies) {}

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2)
      throw new SyncHttpError(429, {
        message: 'Diagnostics are busy. Retry after the current checks finish.',
      });
    this.active++;
    try {
      return await work();
    } catch (error) {
      if (error instanceof SyncHttpError) throw error;
      throw new SyncHttpError(503, {
        message:
          'Diagnostics could not inspect the configured service or runner. Check server configuration and daemon availability.',
      });
    } finally {
      this.active--;
    }
  }

  targets() {
    return this.bounded(() => this.deps.targets());
  }

  connection(input: any) {
    return this.bounded(async () => {
      if (
        !input ||
        Object.keys(input).length !== 1 ||
        !['registry', 'helper'].includes(input.target)
      )
        throw new SyncHttpError(400, { message: 'Choose a configured registry target.' });
      const targets = await this.deps.targets();
      return checkRegistry(
        input.target === 'registry' ? targets.registry : targets.helper,
        this.deps.probe,
      );
    });
  }

  pull(input: any) {
    return this.bounded(async () => {
      if (!input || Object.keys(input).length !== 1 || typeof input.runner !== 'string')
        throw new SyncHttpError(400, { message: 'Choose a configured runner manager.' });
      if (this.pulling)
        throw new SyncHttpError(429, { message: 'A helper pull is already in progress.' });
      this.pulling = true;
      try {
        const targets = await this.deps.targets();
        if (!targets.runners.includes(input.runner))
          throw new SyncHttpError(400, {
            message: 'The selected runner is not an available configured manager.',
          });
        const context = await this.deps.inspect(input.runner);
        if (context.image !== targets.helperImage)
          throw new SyncHttpError(409, {
            message:
              'The runner helper image differs from the configured immutable helper image. Review runner configuration before retrying.',
          });
        const start = performance.now();
        const result = await this.deps.pull(context);
        return {
          runner: context.runner,
          image: context.image,
          context: context.daemon,
          authentication: context.authentication,
          durationMs: Math.round(performance.now() - start),
          success: result.success,
          code: result.code,
          detail: result.success
            ? 'The selected daemon completed this exact helper-image pull. CI startup, runner credentials and other images remain unverified.'
            : 'The selected daemon did not confirm a completed pull. This result alone does not establish a network ban, credential failure or missing digest. Layers may have been cached; a timed-out daemon operation may continue.',
        };
      } finally {
        this.pulling = false;
      }
    });
  }
}
