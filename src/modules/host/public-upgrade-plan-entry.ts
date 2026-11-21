import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import { NativeEntryRuntime } from './native-entry-runtime';
import {
  PublicUpgradePlanService,
  type PublicUpgradePlanPort,
  type PublicUpgradePlanInput,
} from './public-upgrade-plan.service';
const runtime = new NativeEntryRuntime();
export async function publicUpgradePlanMain(): Promise<void> {
  const channel = runtime.channel;
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const input = record(channel.read());
    const port: PublicUpgradePlanPort = {
      publicInputs: (repository, target) =>
        channel.call('publicInputs', [repository, target]) as ReturnType<
          PublicUpgradePlanPort['publicInputs']
        >,
      verifyCheckout: () => {
        channel.call('verifyCheckout');
      },
      installed: (repository, target) => record(channel.call('installed', [repository, target])),
      prerequisite: (checkpoint) => channel.call('prerequisite', [checkpoint]),
      host: () => {
        channel.call('host');
      },
      syncIdle: () => {
        channel.call('syncIdle');
      },
      freeBytes: () => channel.call('freeBytes') as number[],
      backupTarget: (filename) => String(channel.call('backupTarget', [filename])),
      selection: () => channel.call('selection') as ReturnType<PublicUpgradePlanPort['selection']>,
      capture: () => channel.call('capture'),
      invoke: (checkpoint, metadataFile) => {
        channel.call('invoke', [checkpoint, metadataFile]);
      },
      dataSample: () => channel.call('dataSample'),
      now: () => String(channel.call('now')),
    };
    app = await runtime.application(HostModule.register({ publicUpgradePlanPort: port }));
    channel.write({
      complete: true,
      value:
        input.operation === 'interrupt'
          ? app.get(PublicUpgradePlanService).interrupt(String(input.directory), input.attemptId)
          : await app
              .get(PublicUpgradePlanService)
              .plan(input as unknown as PublicUpgradePlanInput),
    });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'public-upgrade-plan-failed',
    });
    process.exitCode = 1;
  } finally {
    await runtime.settled();
  }
}
if (require.main === module) void runtime.run(publicUpgradePlanMain);
