import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import { NativePortChannel } from './native-port-channel';
import {
  ControllerRollbackSequenceService,
  type ControllerRollbackPort,
  type ControllerRollbackInput,
} from './controller-rollback-sequence.service';
export async function controllerRollbackSequenceMain(): Promise<void> {
  const channel = new NativePortChannel();
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
    app = await NestFactory.createApplicationContext(
      HostModule.register({ controllerRollbackPort: port }),
      { logger: false },
    );
    channel.write({ complete: true, value: app.get(ControllerRollbackSequenceService).run(input) });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'controller-rollback-sequence-failed',
    });
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
if (require.main === module) void controllerRollbackSequenceMain();
