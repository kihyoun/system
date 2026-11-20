import 'reflect-metadata';
import path from 'node:path';
import { record } from '../release/source-identity';
import { requireValue } from './install';
import { NestFactory } from '@nestjs/core';
import { ControllerLeaseModule } from './controller-lease.module';
import { ControllerLeaseService, type ControllerLeaseInput } from './controller-lease.service';
import { compatibilityWorker } from './compatibility-worker';
let context: ReturnType<typeof NestFactory.createApplicationContext> | undefined;
const application = () =>
  (context ??= NestFactory.createApplicationContext(ControllerLeaseModule, { logger: false }));
function environment(value: unknown): NodeJS.ProcessEnv | undefined {
  if (value === undefined || value === null) return undefined;
  const row = record(value);
  requireValue(
    Object.entries(row).every(
      ([key, item]) =>
        key.length > 0 && !/[=\0]/.test(key) && typeof item === 'string' && !item.includes('\0'),
    ),
    'invalid-controller-command-environment',
  );
  return row as NodeJS.ProcessEnv;
}
function leaseInput(value: unknown): ControllerLeaseInput {
  const row = record(value);
  requireValue(
    typeof row.root === 'string' && path.isAbsolute(row.root) && !row.root.includes('\0'),
    'invalid-controller-lease-input',
  );
  if (row.seedDirectory !== undefined && row.seedDirectory !== null && row.seedDirectory !== '')
    requireValue(
      typeof row.seedDirectory === 'string' &&
        path.isAbsolute(row.seedDirectory) &&
        !row.seedDirectory.includes('\0'),
      'invalid-controller-lease-input',
    );
  let legacyController: ControllerLeaseInput['legacyController'];
  if (row.legacyController !== undefined && row.legacyController !== null) {
    const controller = record(row.legacyController);
    requireValue(
      controller.Mounts === undefined || Array.isArray(controller.Mounts),
      'invalid-controller-lease-input',
    );
    legacyController = {
      Mounts: (controller.Mounts as unknown[] | undefined)?.map((value) => {
        const mount = record(value);
        requireValue(
          ['Destination', 'Type', 'Source'].every(
            (key) =>
              mount[key] === undefined ||
              (typeof mount[key] === 'string' && !mount[key].includes('\0')),
          ),
          'invalid-controller-lease-input',
        );
        return {
          Destination: mount.Destination as string | undefined,
          Type: mount.Type as string | undefined,
          Source: mount.Source as string | undefined,
        };
      }),
    };
  }
  return {
    root: row.root,
    seedDirectory:
      row.seedDirectory == null || row.seedDirectory === ''
        ? undefined
        : (row.seedDirectory as string),
    legacyController,
  };
}
async function handle(value: unknown) {
  const input = record(value);
  requireValue(
    input.operation === 'controllerLease' && Array.isArray(input.arguments),
    'invalid-controller-lease-operation',
  );
  const args = input.arguments;
  const arities: Record<string, number> = {
    acquire: 2,
    adopt: 3,
    critical: 3,
    idle: 3,
    command: 6,
    release: 2,
    finish: 3,
  };
  const method = args[0];
  requireValue(
    typeof method === 'string' && Object.hasOwn(arities, method) && args.length === arities[method],
    'invalid-controller-lease-operation',
  );
  const config = method === 'acquire' || method === 'adopt' ? leaseInput(args[1]) : undefined;
  const operation = method === 'adopt' ? args[2] : args[1];
  if (method !== 'acquire')
    requireValue(
      typeof operation === 'string' && /^[a-f0-9]{32}$/.test(operation),
      'invalid-controller-operation',
    );
  if (method === 'critical' || method === 'finish')
    requireValue(typeof args[2] === 'boolean', 'invalid-controller-lease-boolean');
  if (method === 'idle')
    requireValue(
      typeof args[2] === 'string' && path.isAbsolute(args[2]) && !args[2].includes('\0'),
      'invalid-controller-lease-directory',
    );
  const inherited = environment(input.environment);
  let commandEnvironment: NodeJS.ProcessEnv | undefined;
  let bytes = Buffer.alloc(0);
  if (method === 'command') {
    requireValue(
      Array.isArray(args[2]) &&
        args[2].length > 0 &&
        args[2].every((item) => typeof item === 'string' && !item.includes('\0')) &&
        args[2][0].length > 0 &&
        typeof args[3] === 'number' &&
        Number.isFinite(args[3]) &&
        args[3] > 0 &&
        args[3] <= 1800,
      'invalid-controller-command',
    );
    requireValue(
      typeof args[4] === 'string' && args[4].length <= Math.ceil((8 * 1024 ** 2) / 3) * 4,
      'invalid-controller-command-input',
    );
    bytes = Buffer.from(args[4], 'base64');
    requireValue(
      bytes.toString('base64') === args[4] && bytes.length <= 8 * 1024 ** 2,
      'invalid-controller-command-input',
    );
    commandEnvironment = environment(args[5]) ?? inherited;
  }
  const lease = (await application()).get(ControllerLeaseService);
  if (method === 'acquire') {
    lease.acquire(config!);
    return lease.describe();
  }
  if (method === 'adopt') {
    lease.adopt(config!, operation as string);
    return lease.describe();
  }
  lease.assertOperation(args[1]);
  switch (method) {
    case 'critical':
      lease.critical = args[2] as boolean;
      return null;
    case 'idle':
      lease.assertIdle(String(args[2]));
      return null;
    case 'command':
      return (
        await lease.command(args[2] as string[], Number(args[3]), bytes, commandEnvironment)
      ).toString('base64');
    case 'release':
      lease.release();
      return null;
    case 'finish':
      lease.finish(args[2] as boolean);
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
