import 'reflect-metadata';
import { NativePortChannel } from './native-port-channel';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import {
  ColdMaintenanceService,
  ActiveMaintenanceJobs,
  type ColdMaintenancePort,
  type ColdMaintenanceInput,
} from './cold-maintenance.service';
/** Fixed native compatibility ports, not a Python coordinator invocation. */
export async function coldMaintenanceMain(): Promise<void> {
  const channel = new NativePortChannel();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const initial = record(channel.read()),
      input = record(initial.input) as unknown as ColdMaintenanceInput;
    const port: ColdMaintenancePort = {
      command: (args, timeout) => {
        channel.call('command', [args, timeout]);
      },
      inspect: (id) => record(channel.call('inspect', [id])),
      phase: (value, deadline) => {
        channel.call('phase', [value, deadline]);
      },
      probe: () => record(channel.call('probe')),
      checkpoint: () => String(channel.call('checkpoint')),
      now: () => Number(channel.call('now')),
      sleep: (seconds) => {
        channel.call('sleep', [seconds]);
      },
      uptime: () => Number(channel.call('uptime')),
      mainHash: () => {
        const value = channel.call('mainHash');
        return value === null ? null : String(value);
      },
    };
    app = await NestFactory.createApplicationContext(
      HostModule.register({ coldMaintenancePort: port }),
      { logger: false },
    );
    const service = app.get(ColdMaintenanceService);
    if (initial.operation !== 'run' && initial.operation !== 'drain')
      throw Error('invalid-cold-maintenance-operation');
    const value = initial.operation === 'run' ? service.run(input) : service.drain(input);
    channel.write({ complete: true, value: value ?? null });
  } catch (error) {
    channel.write({
      complete: true,
      error: error instanceof Error ? error.message : 'cold-maintenance-failed',
      activeJobs: error instanceof ActiveMaintenanceJobs,
    });
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
if (require.main === module) void coldMaintenanceMain();
