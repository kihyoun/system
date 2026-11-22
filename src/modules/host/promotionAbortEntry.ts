import 'reflect-metadata';
import { record } from '../release/sourceIdentity';
import { NativeEntryRuntime } from './nativeEntryRuntime';
import { HostModule } from './host.module';
import {
  PromotionAbortService,
  type PromotionAbortPort,
  type PromotionAbortInput,
} from './promotionAbort.service';
const runtime = new NativeEntryRuntime();
export async function promotionAbortMain(): Promise<void> {
  const channel = runtime.channel;
  try {
    const input = record(record(channel.read()).input) as unknown as PromotionAbortInput;
    const port: PromotionAbortPort = {
      main: () => String(channel.call('main')),
      checkout: (release) => {
        channel.call('checkout', [release]);
      },
      image: (id) => record(channel.call('image', [id])),
      adopt: (operation) => {
        channel.call('adopt', [operation]);
      },
      helper: () => {
        const value = channel.call('helper');
        return value === null ? null : record(value);
      },
      inspectOptional: (id) => {
        const value = channel.call('inspectOptional', [id]);
        return value === null ? null : record(value);
      },
      inspect: (id) => record(channel.call('inspect', [id])),
      command: (args, timeout) => {
        const output = channel.call('command', [args, timeout]);
        return typeof output === 'string' ? output : undefined;
      },
      verifyCheckpoint: (hash) => {
        channel.call('verifyCheckpoint', [hash]);
      },
      bootId: () => String(channel.call('bootId')),
      runners: () => channel.call('runners') as Record<string, unknown>[],
      writeConfiguration: (value) => {
        channel.call('writeConfiguration', [value]);
      },
      reload: () => {
        channel.call('reload');
      },
      services: () => record(channel.call('services')) as Record<string, Record<string, unknown>>,
      mounts: (rows) => {
        channel.call('mounts', [rows]);
      },
      routes: (rows) => {
        channel.call('routes', [rows]);
      },
      sync: () => {
        channel.call('sync');
      },
      journal: (value) => {
        channel.call('journal', [value]);
      },
      timestamp: () => String(channel.call('timestamp')),
      release: () => {
        channel.call('release');
      },
      compose: (args, image) => {
        channel.call('compose', [args, image]);
      },
      phase: (value, deadline) => {
        channel.call('phase', [value, deadline]);
      },
      probe: () => record(channel.call('probe')),
      checkpoint: () => {
        throw Error('abort-must-not-create-database-checkpoint');
      },
      now: () => Number(channel.call('now')),
      sleep: (seconds) => {
        channel.call('sleep', [seconds]);
      },
      uptime: () => Number(channel.call('uptime')),
      mainHash: () => String(channel.call('mainHash')),
    };
    const app = await runtime.application(
      HostModule.register({ promotionAbortPort: port, coldMaintenancePort: port }),
    );
    await app.get(PromotionAbortService).run(input);
    channel.write({ complete: true, value: null });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'promotion-abort-failed',
    });
    process.exitCode = 1;
  } finally {
    await runtime.settled();
  }
}

if (require.main === module) {
  void runtime.run(promotionAbortMain);
}
