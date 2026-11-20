import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import { NativePortChannel } from './native-port-channel';
import { ActiveMaintenanceJobs } from './cold-maintenance.service';
import {
  PromotionSequenceService,
  type PromotionSequencePort,
  type PromotionSequenceInput,
} from './promotion-sequence.service';
export async function promotionSequenceMain(): Promise<void> {
  const channel = new NativePortChannel();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const input = record(record(channel.read()).input) as unknown as PromotionSequenceInput;
    const port: PromotionSequencePort = {
      main: () => String(channel.call('main')),
      sha: (which) => String(channel.call('sha', [which])),
      inspect: (id) => record(channel.call('inspect', [id])),
      assertBaseline: (value) => {
        channel.call('assertBaseline', [value]);
      },
      pipeline: () => {
        channel.call('pipeline');
      },
      critical: (value) => {
        channel.call('critical', [value]);
      },
      journal: (value) => {
        channel.call('journal', [value]);
      },
      readJournal: () => record(channel.call('readJournal')),
      runners: () => channel.call('runners') as unknown[],
      cold: (value, runners) => String(channel.call('cold', [value, runners])),
      syncIdle: () => {
        channel.call('syncIdle');
      },
      command: (args, env) => {
        channel.call('command', [args, env]);
      },
      writeConfiguration: (value) => {
        channel.call('writeConfiguration', [value]);
      },
      reload: () => {
        channel.call('reload');
      },
      waitStaged: (value) => {
        channel.call('waitStaged', [value]);
      },
      gitlabPreflight: () => {
        channel.call('gitlabPreflight');
      },
      now: () => String(channel.call('now')),
    };
    app = await NestFactory.createApplicationContext(
      HostModule.register({ promotionSequencePort: port }),
      { logger: false },
    );
    const value = app.get(PromotionSequenceService).run(input);
    channel.write({ complete: true, value });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'promotion-sequence-failed',
      activeJobs: error instanceof ActiveMaintenanceJobs,
    });
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
if (require.main === module) void promotionSequenceMain();
