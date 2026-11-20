import 'reflect-metadata';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { record } from '../release/source-identity';
import { HostModule } from './host.module';
import {
  ColdMaintenanceService,
  ActiveMaintenanceJobs,
  type ColdMaintenancePort,
  type ColdMaintenanceInput,
} from './cold-maintenance.service';
class NativePortChannel {
  private pending = '';
  read(): unknown {
    while (!this.pending.includes('\n')) {
      const buffer = Buffer.alloc(65536),
        count = fs.readSync(0, buffer, 0, buffer.length, null);
      if (!count) throw Error('host-native-port-disconnected');
      this.pending += buffer.subarray(0, count).toString();
      if (this.pending.length > 16 * 1024 ** 2) throw Error('host-native-port-frame-too-large');
    }
    const end = this.pending.indexOf('\n'),
      line = this.pending.slice(0, end);
    this.pending = this.pending.slice(end + 1);
    return JSON.parse(line);
  }
  write(value: unknown) {
    fs.writeSync(1, JSON.stringify(value) + '\n');
  }
  call(method: string, args: unknown[] = []): unknown {
    this.write({ method, args });
    const response = record(this.read());
    if (typeof response.error === 'string') throw Error(response.error);
    return response.value;
  }
}
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
