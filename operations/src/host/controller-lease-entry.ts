import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ControllerLeaseModule } from './controller-lease.module';
import { ControllerLeaseService, type ControllerLeaseInput } from './controller-lease.service';
import { compatibilityWorker } from './compatibility-worker';
let context: ReturnType<typeof NestFactory.createApplicationContext> | undefined;
const application = () =>
  (context ??= NestFactory.createApplicationContext(ControllerLeaseModule, { logger: false }));
async function handle(input: {
  operation: string;
  arguments: unknown[];
  environment?: NodeJS.ProcessEnv;
}) {
  if (input.operation !== 'controllerLease') throw Error('invalid-controller-lease-operation');
  const args = input.arguments;

  const lease = (await application()).get(ControllerLeaseService),
    method = String(args[0]);
  if (method === 'acquire') {
    lease.acquire(args[1] as ControllerLeaseInput);
    return lease.describe();
  }
  if (method === 'adopt') {
    lease.adopt(args[1] as ControllerLeaseInput, String(args[2]));
    return lease.describe();
  }
  lease.assertOperation(args[1]);
  switch (method) {
    case 'critical':
      lease.critical = Boolean(args[2]);
      return null;
    case 'idle':
      lease.assertIdle(String(args[2]));
      return null;
    case 'command':
      return (
        await lease.command(
          args[2] as string[],
          Number(args[3]),
          Buffer.from(String(args[4]), 'base64'),
          (args[5] ?? input.environment) as NodeJS.ProcessEnv,
        )
      ).toString('base64');
    case 'release':
      lease.release();
      return null;
    case 'finish':
      lease.finish(Boolean(args[2]));
      return null;
    default:
      throw Error('invalid-controller-lease-operation');
  }
}
async function close() {
  if (context) await (await context).close();
}
if (require.main === module)
  compatibilityWorker(handle, close).catch(() => {
    process.exitCode = 1;
  });
