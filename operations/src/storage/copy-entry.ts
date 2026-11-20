import { harvest, restore } from './copy';
import { ProcessFailure } from '../runtime/process';
try {
  if (process.argv[2] === 'harvest')
    harvest(undefined, undefined, process.env.SYSTEM_HARVEST_CERTIFICATE_LEASE);
  else if (process.argv[2] === 'restore') restore();
  else throw Error('invalid-seed-operation');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.error(/^[a-z][a-z0-9-]+$/.test(message) ? message : 'seed-copy-failed');
  process.exitCode =
    error instanceof ProcessFailure && error.status
      ? error.status
      : error instanceof Error && 'exitCode' in error && typeof error.exitCode === 'number'
        ? error.exitCode
        : 1;
}
