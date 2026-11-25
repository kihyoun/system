import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/sourceIdentity';
import { HostModule } from './host.module';
import { NativeEntryRuntime } from './nativeEntryRuntime';
import {
  ControllerRollbackSequenceService,
  type ControllerRollbackPort,
  type ControllerRollbackInput,
} from './controllerRollbackSequence.service';
const runtime = new NativeEntryRuntime();
export async function controllerRollbackSequenceMain(): Promise<void> {
  const channel = runtime.channel;
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const input = record(record(channel.read()).input) as unknown as ControllerRollbackInput;
    const port: ControllerRollbackPort = {
      journal: (value) => {
        channel.call('journal', [value]);
      },
      mainSha: () => String(channel.call('mainSha')),
      pairedBaseline: (value) => {
        channel.call('pairedBaseline', [value]);
      },
      verifySelection: (checkpoint) => {
        channel.call('verifySelection', [checkpoint]);
      },
      services: () => record(channel.call('services')),
      stoppedIdle: () => {
        channel.call('stoppedIdle');
      },
      repairPeers: (value) => {
        channel.call('repairPeers', [value]);
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
      recoveredReceipt: (value) => {
        channel.call('recoveredReceipt', [value]);
      },
      writeSelection: () => {
        channel.call('writeSelection');
      },
      reload: () => {
        channel.call('reload');
      },
      restoreStopped: (value) => channel.call('restoreStopped', [value]),
      waitReady: (value) => channel.call('waitReady', [value]),
      inspectServices: () => record(channel.call('inspectServices')),
      now: () => String(channel.call('now')),
      verification: (value) => {
        channel.call('verification', [value]);
      },
    };
    app = await runtime.application(HostModule.register({ controllerRollbackPort: port }));
    channel.write({
      complete: true,
      value: await app.get(ControllerRollbackSequenceService).run(input),
    });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'controller-rollback-sequence-failed',
    });
    process.exitCode = 1;
  } finally {
    await runtime.settled();
  }
}

if (require.main === module) {
  void runtime.run(controllerRollbackSequenceMain);
}
