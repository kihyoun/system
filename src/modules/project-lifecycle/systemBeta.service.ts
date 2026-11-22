import { run as stopReview } from './legacyReviewSession';
import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import { Runtime } from './environmentRuntime';
import { BetaOptions, run } from './systemBetaSession';
import { plan } from './systemBetaPlan';
export const betaOptions = Symbol('BETA_OPTIONS');
@Injectable()
export class SystemBetaService {
  constructor(@Inject(betaOptions) private readonly options: BetaOptions) {}

  stopReview(action: string, env: NodeJS.ProcessEnv) {
    return stopReview(action, env, this.options);
  }

  run(action: string, env: NodeJS.ProcessEnv) {
    return run(action, env, this.options);
  }

  async bind(args: string[]) {
    if (!['plan', 'apply'].includes(args[0]) || args.length !== (args[0] === 'plan' ? 2 : 3)) {
      throw new Error('Use plan INPUT or apply INPUT PLAN_HASH.');
    }

    const stat = fs.lstatSync(args[1]);

    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 10000) {
      throw new Error('A private regular input file is required.');
    }

    const input: unknown = JSON.parse(fs.readFileSync(args[1], 'utf8'));

    if (
      !input ||
      typeof input !== 'object' ||
      !('operation' in input) ||
      typeof input.operation !== 'string'
    ) {
      throw Error('The selected environment reservation changed.');
    }

    const driver = this.options.Runtime || Runtime;
    const runtime = new driver({
      operation: input.operation,
      action: 'stop',
      kind: 'beta',
      projectId: 1,
      pipelineId: 1,
      jobId: 1,
      mrIid: 0,
      sourceCommit: '0'.repeat(40),
    });
    let attempted = false,
      locked = false;
    try {
      if (args[0] === 'apply') {
        attempted = true;
        await runtime.canonical('lock');
        locked = true;
      }

      const selected = await plan(runtime, input);

      if (args[0] === 'plan') {
        return selected;
      }

      if (selected.planHash !== args[2]) {
        throw new Error('System Beta plan changed; inspect a fresh plan.');
      }

      await runtime.canonical('bind-system-beta', {
        binding: selected.binding,
        expectedHash: selected.configurationHash,
        previousBindingHash: selected.previousBindingHash,
      });
      return {
        state: 'bound',
        projectId: selected.binding.projectId,
        mrIid: selected.binding.mrIid,
        pipelineId: selected.binding.pipelineId,
        sourceCommit: selected.binding.sourceCommit,
      };
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
