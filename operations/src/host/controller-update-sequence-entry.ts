import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import { NativeEntryRuntime } from './native-entry-runtime';
import {
  ControllerUpdateSequenceService,
  type ControllerUpdateSequencePort,
  type ControllerUpdateSequenceInput,
} from './controller-update-sequence.service';
const runtime = new NativeEntryRuntime();
export async function controllerUpdateSequenceMain(): Promise<void> {
  const channel = runtime.channel;
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const input = record(record(channel.read()).input) as unknown as ControllerUpdateSequenceInput;
    const port: ControllerUpdateSequencePort = {
      journal: (value) => {
        channel.call('journal', [value]);
      },
      assertBaseline: (value) => {
        channel.call('assertBaseline', [value]);
      },
      verifySelection: (checkpoint) => {
        channel.call('verifySelection', [checkpoint]);
      },
      publicImages: () => channel.call('publicImages'),
      pipeline: () => {
        channel.call('pipeline');
      },
      publicPair: () => channel.call('publicPair'),
      syncIdle: () => {
        channel.call('syncIdle');
      },
      currentServices: () => record(channel.call('currentServices')),
      repairBaseline: (value) => {
        channel.call('repairBaseline', [value]);
      },
      critical: () => {
        channel.call('critical');
      },
      command: (args, reference) => {
        channel.call('command', [args, reference]);
      },
      inspect: (id) => record(channel.call('inspect', [id])),
      writeConfiguration: (bytes, metadata) => {
        channel.call('writeConfiguration', [bytes, metadata]);
      },
      writeSelection: () => {
        channel.call('writeSelection');
      },
      now: () => String(channel.call('now')),
      reload: () => {
        channel.call('reload');
      },
      saveBaseline: (value) => {
        channel.call('saveBaseline', [value]);
      },
      waitReady: (value) => channel.call('waitReady', [value]),
      services: () => record(channel.call('services')),
      saveVerification: (value) => {
        channel.call('saveVerification', [value]);
      },
    };
    app = await runtime.application(HostModule.register({ controllerUpdateSequencePort: port }));
    channel.write({ complete: true, value: app.get(ControllerUpdateSequenceService).run(input) });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'controller-update-sequence-failed',
    });
    process.exitCode = 1;
  } finally {
    await runtime.settled();
  }
}
if (require.main === module) void runtime.run(controllerUpdateSequenceMain);
