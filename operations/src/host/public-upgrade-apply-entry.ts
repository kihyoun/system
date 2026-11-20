import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import { NativePortChannel } from './native-port-channel';
import {
  PublicUpgradeApplyService,
  type PublicUpgradeApplyPort,
} from './public-upgrade-apply.service';
export async function publicUpgradeApplyMain(): Promise<void> {
  const channel = new NativePortChannel();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const input = record(channel.read());
    const port: PublicUpgradeApplyPort = {
      publicInputs: (repository, target) =>
        channel.call('publicInputs', [repository, target]) as ReturnType<
          PublicUpgradeApplyPort['publicInputs']
        >,
      prerequisite: (checkpoint) => channel.call('prerequisite', [checkpoint]),
      installed: (repository, target) => record(channel.call('installed', [repository, target])),
      fingerprints: () =>
        channel.call('fingerprints') as ReturnType<PublicUpgradeApplyPort['fingerprints']>,
      assertBaseline: (value) => {
        channel.call('assertBaseline', [value]);
      },
      dataSample: () => channel.call('dataSample'),
      host: () => {
        channel.call('host');
      },
      backupTarget: (filename) => {
        channel.call('backupTarget', [filename]);
      },
      invoke: (checkOnly, checkpoint, baseline) => {
        channel.call('invoke', [checkOnly, checkpoint, baseline]);
      },
      archive: (role, image, source) => channel.call('archive', [role, image, source]),
      matchingBackup: (plan) => {
        channel.call('matchingBackup', [plan]);
      },
      waitReady: (baseline) => channel.call('waitReady', [baseline]),
    };
    app = await NestFactory.createApplicationContext(
      HostModule.register({ publicUpgradeApplyPort: port }),
      { logger: false },
    );
    channel.write({
      complete: true,
      value: app.get(PublicUpgradeApplyService).apply(String(input.directory), input.confirmation),
    });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'public-upgrade-apply-failed',
    });
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
if (require.main === module) void publicUpgradeApplyMain();
